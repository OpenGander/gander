import type { Config } from 'drizzle-kit';

function connectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = process.env.POSTGRES_HOST || 'localhost';
  const port = process.env.POSTGRES_PORT || '5432';
  const user = process.env.POSTGRES_USER || 'opengander';
  const password = process.env.POSTGRES_PASSWORD || 'opengander';
  const database = process.env.POSTGRES_DB || 'opengander';
  return `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

export default {
  schema: './src/lib/db/schema.ts',
  out: './src/lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: connectionString() },
  // Keep generated SQL reviewable in PRs rather than pushing straight to the DB.
  strict: true,
  verbose: true,
} satisfies Config;
