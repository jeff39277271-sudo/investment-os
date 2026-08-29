import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { Pool as PgPool } from 'pg';
import * as schema from './schema.js';
import { InvestmentRepository } from './repositories.js';

export function createDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export function createRepository(databaseUrl: string) {
  return new InvestmentRepository(createDb(new PgPool({ connectionString: databaseUrl })));
}
