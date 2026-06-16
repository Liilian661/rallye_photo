import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListBucketsCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import pool from '../config/database';
import { decrypt } from './encryption';

interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

let cachedConfig: S3Config | null = null;
let cachedClient: S3Client | null = null;

// audit: MED-020 — Validation/normalisation des cles S3 pour empecher le path
// traversal, l'ecrasement croise ou la suppression de fichiers d'autres
// organisateurs si une cle derive d'une entree client non sanitizee en amont.
// Les cles legitimes sont de la forme `<code>/<dossier>/<fichier>` avec un
// charset restreint. On rejette : cle vide, slash initial, '..', segments
// vides, backslashs, schemes (http:, s3:, //) et tout caractere hors allowlist.
// audit: MED-020 — la review autorise un underscore/point/tiret en tete de
// segment : sanitizeForS3 (submissions.ts) peut produire un fichier commencant
// par '_' quand le prenom sanitize est vide (ex: '_a1b2c3d4.webp'). Un charset
// restreint sans contrainte sur le 1er caractere suffit pour bloquer le path
// traversal (les segments '.'/'..' restent rejetes explicitement ci-dessous).
const S3_KEY_SEGMENT = /^[A-Za-z0-9._-]+$/;

function assertValidS3Key(key: string): string {
  if (typeof key !== 'string' || key.length === 0 || key.length > 1024) {
    throw new Error('Cle S3 invalide');
  }
  // Rejette slash initial/final, backslash, double-slash, et schemes d'URL.
  if (
    key.startsWith('/') ||
    key.endsWith('/') ||
    key.includes('\\') ||
    key.includes('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(key) // ex: http:, s3:, file:
  ) {
    throw new Error('Cle S3 invalide (format)');
  }
  const segments = key.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..' || !S3_KEY_SEGMENT.test(seg)) {
      throw new Error('Cle S3 invalide (composant suspect)');
    }
  }
  return key;
}

/**
 * Recupere la config S3 depuis la BDD (settings) et la dechiffre
 */
export async function getS3Config(): Promise<S3Config | null> {
  if (cachedConfig) return cachedConfig;

  try {
    const [rows] = await pool.execute(
      "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('s3_endpoint', 's3_region', 's3_bucket', 's3_access_key', 's3_secret_key')"
    );
    const settings = rows as { setting_key: string; setting_value: string }[];

    const map: Record<string, string> = {};
    for (const s of settings) {
      map[s.setting_key] = s.setting_value;
    }

    // audit: LOW-053 — verifie la presence de CHAQUE cle individuellement
    // (length < 5 ne garantissait pas que les 5 cles attendues soient la).
    const required = ['s3_endpoint', 's3_region', 's3_bucket', 's3_access_key', 's3_secret_key'];
    for (const k of required) {
      if (!map[k]) return null; // reellement non configure
    }

    // access_key et secret_key sont chiffres.
    // audit: LOW-053 — une erreur de dechiffrement (cle changee / valeur
    // corrompue) ne doit PAS etre masquee en 'non configure' : on log
    // specifiquement et on propage (catch externe -> null avec log distinct).
    let accessKeyId: string;
    let secretAccessKey: string;
    try {
      accessKeyId = decrypt(map['s3_access_key']);
      secretAccessKey = decrypt(map['s3_secret_key']);
    } catch (decErr) {
      console.error('[S3] Echec de dechiffrement des credentials S3 (config presente mais illisible):', decErr);
      return null;
    }

    cachedConfig = {
      endpoint: map['s3_endpoint'],
      region: map['s3_region'],
      bucket: map['s3_bucket'],
      accessKeyId,
      secretAccessKey,
    };

    return cachedConfig;
  } catch (error) {
    console.error('Erreur lecture config S3:', error);
    return null;
  }
}

/**
 * Invalide le cache (apres mise a jour des settings)
 */
export function invalidateS3Cache(): void {
  cachedConfig = null;
  cachedClient = null;
}

/**
 * Retourne un S3Client configure
 */
export async function getS3Client(): Promise<S3Client | null> {
  if (cachedClient) return cachedClient;

  const config = await getS3Config();
  if (!config) return null;

  cachedClient = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true, // Requis pour IONOS S3
  });

  return cachedClient;
}

/**
 * Upload un fichier sur S3
 */
export async function uploadToS3(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  const safeKey = assertValidS3Key(key); // audit: MED-020
  const client = await getS3Client();
  const config = await getS3Config();

  if (!client || !config) {
    throw new Error('S3 non configure. Configurez les credentials dans le panel admin.');
  }

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: safeKey,
    Body: body,
    ContentType: contentType,
  }));

  return safeKey;
}

/**
 * Supprime un fichier de S3
 */
export async function deleteFromS3(key: string): Promise<void> {
  const safeKey = assertValidS3Key(key); // audit: MED-020
  const client = await getS3Client();
  const config = await getS3Config();

  if (!client || !config) {
    throw new Error('S3 non configure');
  }

  await client.send(new DeleteObjectCommand({
    Bucket: config.bucket,
    Key: safeKey,
  }));
}

/**
 * Genere une URL presignee pour acceder a un fichier (lecture)
 */
export async function getSignedDownloadUrl(
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  const safeKey = assertValidS3Key(key); // audit: MED-020
  const client = await getS3Client();
  const config = await getS3Config();

  if (!client || !config) {
    throw new Error('S3 non configure');
  }

  // audit: INFO-008 — Aucune verification d'ownership ici : l'appelant DOIT
  // fournir une cle issue d'une ressource deja filtree par user_id/owner.
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: safeKey,
  });

  return getSignedUrl(client, command, { expiresIn });
}

/**
 * Teste la connexion S3 (utilise pour le bouton "Tester" dans l'admin)
 */
export async function testS3Connection(): Promise<{ success: boolean; message: string }> {
  // audit: INFO-009 — invalide le cache au debut pour tester la config
  // FRAICHEMENT enregistree (sinon on testerait l'ancienne config en cache,
  // diagnostic trompeur apres rotation de credentials).
  invalidateS3Cache();

  try {
    const client = await getS3Client();
    const config = await getS3Config();

    if (!client || !config) {
      return { success: false, message: 'S3 non configure' };
    }

    // Verifie que le bucket existe et est accessible
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));

    // audit: INFO-012 — separateur corrige (caractere UTF-8 valide)
    return { success: true, message: 'Connexion S3 OK - bucket "' + config.bucket + '" accessible' };
  } catch (error: any) {
    // audit: LOW-052 — ne jamais renvoyer error.message brut au client
    // (fuite de details d'infra). Message generique en fallback, detail logge.
    console.error('[S3] testS3Connection error:', error);
    const msg = error.name === 'NotFound'
      ? 'Bucket introuvable'
      : error.name === 'Forbidden' || error.Code === 'AccessDenied'
        ? 'Acces refuse - verifiez les credentials' // audit: INFO-012 separateur corrige
        : error.code === 'ERR_INVALID_URL'
          ? 'Endpoint URL invalide'
          : 'Erreur de connexion S3'; // audit: LOW-052 message generique

    return { success: false, message: msg };
  }
}