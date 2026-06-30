/**
 * Applies pending Drizzle migrations against the configured Postgres database.
 *
 * Run locally:   npm run db:migrate
 * Run in deploy: node dist/lib/db/migrate.js (or via the same npm script in CI)
 *
 * Migrations are generated from schema.ts with `npm run db:generate` and live
 * in ./migrations as reviewable SQL.
 */
import { existsSync } from 'node:fs';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb, closePool } from './index';
import logger from '../logger';

async function main(): Promise<void> {
  const migrationsFolder = `${__dirname}/migrations`;

  // The journal only exists once `npm run db:generate` has produced at least one
  // migration (Phase A onward). Before then, there is nothing to apply.
  if (!existsSync(`${migrationsFolder}/meta/_journal.json`)) {
    logger.info('No migrations generated yet — skipping');
    return;
  }

  const db = getDb();
  logger.info('Running Postgres migrations…');
  await migrate(db, { migrationsFolder });
  logger.info('Postgres migrations complete');
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err }, 'Postgres migration failed');
    await closePool();
    process.exit(1);
  });
