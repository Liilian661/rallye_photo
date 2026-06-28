import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  connectTimeout: 10000,
  timezone: '+00:00',
});

// Set UTC session timezone once per new physical connection (not per query)
const internalPool: any = (pool as any).pool;
if (typeof internalPool?.on === 'function') {
  internalPool.on('connection', (conn: any) => {
    conn.query("SET time_zone = '+00:00'");
  });
} else {
  console.warn('[DB] Cannot hook connection event — time_zone may not be UTC');
}

export async function testConnection(): Promise<void> {
  try {
    const [rows] = await pool.execute('SELECT NOW() as db_now');
    const dbNow = (rows as any[])[0]?.db_now;
    console.log('MySQL connected successfully (session timezone: UTC)');
    console.log('DB NOW():', dbNow, '| Node Date:', new Date().toISOString());
  } catch (error) {
    console.error('MySQL connection failed:', error);
    process.exit(1);
  }
}

export default pool;
