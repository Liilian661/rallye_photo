import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto'; // audit: LOW-055 — nom de fichier imprevisible

const execFileAsync = promisify(execFile);

// audit: MED-018 — Fail-closed par defaut en production.
// AV_REQUIRED explicite a 'true'/'false' a priorite ; sinon on derive de
// NODE_ENV : en prod, un scan indisponible/echoue REFUSE l'upload (fail-closed).
function resolveAvRequired(): boolean {
  const explicit = process.env.AV_REQUIRED;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return process.env.NODE_ENV === 'production';
}
const AV_REQUIRED = resolveAvRequired();

// audit: INFO-011 — Limite de taille du buffer scanne (defaut 60MB, couvre la
// limite d'upload de 50MB). Au-dela on ne marque jamais clean silencieusement
// si l'AV est requis : on refuse (evite le contournement par fichier enorme
// declenchant un timeout fail-open).
const MAX_SCAN_BYTES = parseInt(process.env.AV_MAX_BYTES || String(60 * 1024 * 1024));

export interface ScanResult {
  clean: boolean;
  virus?: string;
  skipped?: boolean; // true when ClamAV is not installed and AV_REQUIRED=false
}

// Cache availability check: undefined = not yet checked
let clamBin: string | null | undefined = undefined;
// audit: LOW-056 — Horodatage de la derniere detection NEGATIVE pour re-check
// periodique (ClamAV peut demarrer apres l'API). Une detection positive reste
// memorisee definitivement.
let lastNegativeDetectAt = 0;
const NEGATIVE_RECHECK_MS = 5 * 60 * 1000;

async function detectClamBin(): Promise<string | null> {
  // audit: LOW-056 — si binaire trouve, on garde le cache ; si non trouve,
  // on re-tente apres NEGATIVE_RECHECK_MS pour ne pas rester desactive a vie.
  if (typeof clamBin === 'string') return clamBin;
  if (clamBin === null && Date.now() - lastNegativeDetectAt < NEGATIVE_RECHECK_MS) {
    return null;
  }

  for (const bin of ['clamdscan', 'clamscan']) {
    try {
      await execFileAsync(bin, ['--version'], { timeout: 5000 });
      clamBin = bin;
      console.log('[AV] ClamAV binary found:', bin);
      return bin;
    } catch {}
  }
  clamBin = null;
  lastNegativeDetectAt = Date.now();
  console.warn('[AV] ClamAV not found — antivirus scanning is disabled (re-check dans 5min)');
  return null;
}

export async function scanBuffer(buffer: Buffer, filename = 'upload'): Promise<ScanResult> {
  // audit: INFO-011 — verifie la taille en amont du scan
  if (buffer.length > MAX_SCAN_BYTES) {
    if (AV_REQUIRED) {
      console.error('[AV] Buffer trop volumineux pour le scan, upload refusé:', buffer.length);
      return { clean: false, virus: 'Fichier trop volumineux pour le scan antivirus' };
    }
    console.warn('[AV] Buffer trop volumineux, scan ignoré (upload allowed):', buffer.length);
    return { clean: true, skipped: true };
  }

  const bin = await detectClamBin();
  if (!bin) {
    if (AV_REQUIRED) {
      console.error('[AV] ClamAV indisponible mais AV requis — upload refusé');
      return { clean: false, virus: 'Antivirus indisponible' };
    }
    return { clean: true, skipped: true };
  }

  // audit: LOW-055 / INFO-010 — nom imprevisible (randomUUID) ; le nom d'origine
  // n'est plus utilise dans le chemin (predictibilite supprimee).
  const tmpPath = join(tmpdir(), `rp-av-${randomUUID()}`);

  try {
    // audit: INFO-010 — permissions restreintes (0600) : fichier lisible
    // uniquement par le proprietaire pendant la fenetre de scan.
    await writeFile(tmpPath, buffer, { mode: 0o600 });

    await execFileAsync(bin, ['--no-summary', '--stdout', tmpPath], { timeout: 30000 });
    return { clean: true };
  } catch (err: any) {
    const stdout: string = (err && err.stdout) || '';
    const stderr: string = (err && err.stderr) || '';
    const combined = stdout + stderr;

    // audit: MED-017 — Detection robuste de 'FOUND', independante du code de
    // sortie (certaines versions/erreurs renvoient un code different). Toute
    // occurrence de ' FOUND' dans la sortie est traitee comme une menace.
    if (/\bFOUND\b/.test(combined)) {
      const match = combined.match(/:\s*(.+?)\s+FOUND/);
      const virus = match?.[1]?.trim() || 'Virus inconnu';
      console.warn('[AV] Threat detected:', virus, 'in', filename);
      return { clean: false, virus };
    }

    // audit: MED-017 / MED-018 — Ambiguite (code 2 scan error, ENOENT, timeout).
    // Si l'AV est requis (prod par defaut), on NE marque PAS clean : fail-closed.
    if (AV_REQUIRED) {
      console.error('[AV] Scan error, upload refusé (fail-closed):', err.code, err.message?.slice(0, 120));
      return { clean: false, virus: 'Erreur du scan antivirus' };
    }
    console.error('[AV] Scan error (upload allowed):', err.code, err.message?.slice(0, 120));
    return { clean: true, skipped: true };
  } finally {
    unlink(tmpPath).catch(() => {});
  }
}
