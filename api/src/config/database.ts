import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const rawPool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: process.env.DB_SSL === 'true' ? {} : undefined,
  connectTimeout: 10000,
  // Force mysql2 a interpreter les DATETIME comme UTC (pas le fuseau local du VPS)
  timezone: '+00:00',
});

// Wrapper: chaque execute/query force d'abord SET time_zone UTC sur la connexion
// pour que NOW(), CURRENT_TIMESTAMP, etc. retournent de l'UTC
const pool = {
  async execute(...args: Parameters<typeof rawPool.execute>) {
    const conn = await rawPool.getConnection();
    try {
      await conn.execute("SET time_zone = '+00:00'");
      const result = await conn.execute(...args as [any, ...any[]]);
      return result;
    } finally {
      conn.release();
    }
  },
  async query(...args: Parameters<typeof rawPool.query>) {
    const conn = await rawPool.getConnection();
    try {
      await conn.execute("SET time_zone = '+00:00'");
      const result = await conn.query(...args as [any, ...any[]]);
      return result;
    } finally {
      conn.release();
    }
  },
  async getConnection() {
    const conn = await rawPool.getConnection();
    await conn.execute("SET time_zone = '+00:00'");
    return conn;
  },
} as unknown as mysql.Pool;

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