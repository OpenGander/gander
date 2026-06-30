import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import logger from '../logger';
import * as schema from './schema';

let pool: Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;

/**
 * Build a Postgres connection string from individual env vars, or use
 * DATABASE_URL directly if provided (e.g. RDS in production).
 */
function connectionString(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const host = process.env.POSTGRES_HOST || 'localhost';
  const port = process.env.POSTGRES_PORT || '5432';
  const user = process.env.POSTGRES_USER || 'opengander';
  const password = process.env.POSTGRES_PASSWORD || 'opengander';
  const database = process.env.POSTGRES_DB || 'opengander';

  return `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

/**
 * Lazily-initialized singleton Postgres pool. Long-lived ECS tasks pool fine;
 * if anything ever runs on Lambda, front this with RDS Proxy.
 */
export function getPool(): Pool {
  if (!pool) {
    const ssl = process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
    pool = new Pool({
      connectionString: connectionString(),
      ssl,
      max: Number(process.env.POSTGRES_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });

    pool.on('error', (err) => {
      logger.error({ err }, 'Postgres pool error');
    });

    const { host, port, database } = poolTarget();
    logger.info({ host, port, database }, 'Postgres pool initialized');
  }

  return pool;
}

/**
 * Drizzle ORM handle bound to the shared pool and schema. This is the primary
 * entrypoint for application-layer queries.
 */
export function getDb(): NodePgDatabase<typeof schema> {
  if (!db) {
    db = drizzle(getPool(), { schema });
  }
  return db;
}

/** Connectivity check, parallels testClickHouseConnection(). */
export async function testPostgresConnection(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Postgres connection failed');
    return false;
  }
}

/** For tests / graceful shutdown. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}

/** Best-effort parse of the configured target for logging (never logs credentials). */
function poolTarget(): { host: string; port: string; database: string } {
  try {
    const u = new URL(connectionString());
    return {
      host: u.hostname,
      port: u.port || '5432',
      database: u.pathname.replace(/^\//, ''),
    };
  } catch {
    return { host: 'unknown', port: '', database: '' };
  }
}

export { schema };
