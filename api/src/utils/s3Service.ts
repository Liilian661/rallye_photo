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

    if (settings.length < 5) return null;

    const map: Record<string, string> = {};
    for (const s of settings) {
      map[s.setting_key] = s.setting_value;
    }

    // access_key et secret_key sont chiffres
    cachedConfig = {
      endpoint: map['s3_endpoint'],
      region: map['s3_region'],
      bucket: map['s3_bucket'],
      accessKeyId: decrypt(map['s3_access_key']),
      secretAccessKey: decrypt(map['s3_secret_key']),
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
  const client = await getS3Client();
  const config = await getS3Config();

  if (!client || !config) {
    throw new Error('S3 non configure. Configurez les credentials dans le panel admin.');
  }

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));

  return key;
}

/**
 * Supprime un fichier de S3
 */
export async function deleteFromS3(key: string): Promise<void> {
  const client = await getS3Client();
  const config = await getS3Config();

  if (!client || !config) {
    throw new Error('S3 non configure');
  }

  await client.send(new DeleteObjectCommand({
    Bucket: config.bucket,
    Key: key,
  }));
}

/**
 * Genere une URL presignee pour acceder a un fichier (lecture)
 */
export async function getSignedDownloadUrl(
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  const client = await getS3Client();
  const config = await getS3Config();

  if (!client || !config) {
    throw new Error('S3 non configure');
  }

  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn });
}

/**
 * Teste la connexion S3 (utilise pour le bouton "Tester" dans l'admin)
 */
export async function testS3Connection(): Promise<{ success: boolean; message: string }> {
  try {
    const client = await getS3Client();
    const config = await getS3Config();

    if (!client || !config) {
      return { success: false, message: 'S3 non configure' };
    }

    // Verifie que le bucket existe et est accessible
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));

    return { success: true, message: 'Connexion S3 OK — bucket "' + config.bucket + '" accessible' };
  } catch (error: any) {
    const msg = error.name === 'NotFound'
      ? 'Bucket introuvable'
      : error.name === 'Forbidden' || error.Code === 'AccessDenied'
        ? 'Acces refuse — verifiez les credentials'
        : error.code === 'ERR_INVALID_URL'
          ? 'Endpoint URL invalide'
          : error.message || 'Erreur inconnue';

    return { success: false, message: msg };
  }
}