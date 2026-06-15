import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const execFileAsync = promisify(execFile);

export interface ScanResult {
  clean: boolean;
  virus?: string;
  skipped?: boolean; // true when ClamAV is not installed — upload is allowed
}

// Cache availability check: undefined = not yet checked
let clamBin: string | null | undefined = undefined;

async function detectClamBin(): Promise<string | null> {
  if (clamBin !== undefined) return clamBin;
  for (const bin of ['clamdscan', 'clamscan']) {
    try {
      await execFileAsync(bin, ['--version'], { timeout: 5000 });
      clamBin = bin;
      console.log('[AV] ClamAV binary found:', bin);
      return bin;
    } catch {}
  }
  clamBin = null;
  console.warn('[AV] ClamAV not found — antivirus scanning is disabled');
  return null;
}

export async function scanBuffer(buffer: Buffer, filename = 'upload'): Promise<ScanResult> {
  const bin = await detectClamBin();
  if (!bin) return { clean: true, skipped: true };

  const safeFilename = filename.replace(/[^a-z0-9._-]/gi, '_').slice(0, 60);
  const tmpPath = join(tmpdir(), `rp-av-${Date.now()}-${safeFilename}`);

  try {
    await writeFile(tmpPath, buffer);

    await execFileAsync(bin, ['--no-summary', '--stdout', tmpPath], { timeout: 30000 });
    return { clean: true };
  } catch (err: any) {
    const stdout: string = err.stdout || '';

    if (err.code === 1 && stdout.includes('FOUND')) {
      const match = stdout.match(/: (.+) FOUND/);
      const virus = match?.[1]?.trim() || 'Virus inconnu';
      console.warn('[AV] Threat detected:', virus, 'in', safeFilename);
      return { clean: false, virus };
    }

    // code 2 = scan error, ENOENT = bin disappeared, timeout, etc. → be permissive
    console.error('[AV] Scan error (upload allowed):', err.code, err.message?.slice(0, 100));
    return { clean: true, skipped: true };
  } finally {
    unlink(tmpPath).catch(() => {});
  }
}
