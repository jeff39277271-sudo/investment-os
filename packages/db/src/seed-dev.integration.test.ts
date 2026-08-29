import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { developmentInstruments, seedDevelopmentInstruments } from './seed-dev.js';

const integration = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://investment:investment@localhost:5432/investment_os' });
const db = createDb(pool);

integration('development instrument seed', () => {
  beforeAll(async () => { await pool.query('select 1'); });
  beforeEach(async () => { await pool.query('TRUNCATE TABLE alert_trigger_events, alert_rules, line_webhook_events, instrument_quotes, transactions, transaction_drafts, position_snapshots, instruments, portfolios, user_identities, users CASCADE'); });
  afterAll(async () => pool.end());

  it('upserts the development master by symbol and exchange without duplicates', async () => {
    await seedDevelopmentInstruments(db);
    await pool.query("update instruments set name = 'stale', provider_symbol = 'stale' where symbol = '2330' and exchange = 'TWSE'");
    await seedDevelopmentInstruments(db);

    const result = await pool.query('select symbol, name, exchange, market, currency, asset_type, provider_symbol from instruments order by symbol');
    expect(result.rows).toEqual(developmentInstruments.map((instrument) => ({
      symbol: instrument.symbol,
      name: instrument.name,
      exchange: instrument.exchange,
      market: instrument.market,
      currency: instrument.currency,
      asset_type: instrument.assetType,
      provider_symbol: instrument.providerSymbol,
    })).sort((left, right) => left.symbol.localeCompare(right.symbol)));
  });
});
