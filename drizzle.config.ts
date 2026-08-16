import type { Config } from 'drizzle-kit';

export default { schema: './packages/db/src/schema.ts', out: './packages/db/drizzle', dialect: 'postgresql', dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://investment:investment@localhost:5432/investment_os' } } satisfies Config;
