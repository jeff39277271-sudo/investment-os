import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { createDb } from './client.js';
import { instruments } from './schema.js';
import type { Database } from './repositories.js';

export const developmentInstruments = [
  { symbol: '2330', name: '台積電', exchange: 'TWSE', market: 'TW', currency: 'TWD', assetType: 'EQUITY', providerSymbol: '2330' },
  { symbol: '0050', name: '元大台灣50', exchange: 'TWSE', market: 'TW', currency: 'TWD', assetType: 'ETF', providerSymbol: '0050' },
] as const;

export async function seedDevelopmentInstruments(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    for (const instrument of developmentInstruments) {
      await tx.insert(instruments).values(instrument).onConflictDoUpdate({
        target: [instruments.symbol, instruments.exchange],
        set: {
          name: instrument.name,
          market: instrument.market,
          currency: instrument.currency,
          assetType: instrument.assetType,
          providerSymbol: instrument.providerSymbol,
        },
      });
    }
  });
}

export async function runDevelopmentInstrumentSeed(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Missing required environment variable: DATABASE_URL');
  const pool = new Pool({ connectionString: databaseUrl });
  try { await seedDevelopmentInstruments(createDb(pool)); }
  finally { await pool.end(); }
}

const executablePath = process.argv[1];
if (executablePath && import.meta.url === pathToFileURL(executablePath).href) {
  runDevelopmentInstrumentSeed()
    .then(() => console.log(`Development instrument seed complete: ${developmentInstruments.map(({ symbol }) => symbol).join(', ')}`))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Development instrument seed failed');
      process.exitCode = 1;
    });
}
