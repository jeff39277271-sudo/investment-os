import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, InvestmentRepository } from '@investment-os/db';
import { Decimal, DomainValidationError } from '@investment-os/domain';
import { FakeMarketDataProvider, QuoteFreshnessPolicy } from '@investment-os/market-data';
import { ApplicationAuthorizationError, MarketDataApplicationService } from './index.js';

const integration = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://investment:investment@localhost:5432/investment_os' });
const repository = new InvestmentRepository(createDb(pool));
let now = new Date('2026-08-29T02:05:00.000Z');
const service = new MarketDataApplicationService(repository, new QuoteFreshnessPolicy(5 * 60 * 1000), () => now);

async function fixture() {
  const user = await repository.createUser({ displayName: 'Market Data User' });
  const otherUser = await repository.createUser({ displayName: 'Other User' });
  const portfolio = await repository.createPortfolio({ userId: user.id, name: 'Main', baseCurrency: 'TWD' });
  const instrument = await repository.createInstrument({ symbol: '2330', name: '台積電', exchange: 'TWSE', market: 'TW', currency: 'TWD', assetType: 'EQUITY', providerSymbol: '2330' });
  return { user, otherUser, portfolio, instrument };
}

async function transaction(f: Awaited<ReturnType<typeof fixture>>, side: 'BUY' | 'SELL', quantity: string, price: string) {
  return repository.insertTransaction({ id: randomUUID(), portfolioId: f.portfolio.id, instrumentId: f.instrument.id, side, quantity, price, currency: 'TWD', fee: '0', tax: '0', tradeAt: now, source: 'MANUAL', status: 'CONFIRMED', idempotencyKey: randomUUID() });
}

function quote(f: Awaited<ReturnType<typeof fixture>>, price: string, quoteAt: Date, currency = 'TWD') {
  return { instrumentId: f.instrument.id, symbol: f.instrument.symbol, price: new Decimal(price), currency, quoteAt, receivedAt: now, source: 'INTEGRATION_TEST' };
}

integration('market data persistence and valuation', () => {
  beforeAll(async () => { await pool.query('select 1'); });
  beforeEach(async () => {
    now = new Date('2026-08-29T02:05:00.000Z');
    await pool.query('TRUNCATE TABLE line_webhook_events, instrument_quotes, transactions, transaction_drafts, position_snapshots, instruments, portfolios, user_identities, users CASCADE');
  });
  afterAll(async () => pool.end());

  it('persists Decimal prices, returns the deterministic latest quote, and deduplicates ingestion', async () => {
    const f = await fixture();
    const older = quote(f, '1299.123456789123', new Date('2026-08-29T02:00:00.000Z'));
    const latest = quote(f, '1300.000000000001', new Date('2026-08-29T02:04:00.000Z'));
    await service.ingestQuote(older); await service.ingestQuote(latest); await service.ingestQuote(latest);
    expect((await repository.getLatestQuote(f.instrument.id))?.price).toBe('1300.000000000001');
    expect(Number((await pool.query('select count(*) from instrument_quotes')).rows[0].count)).toBe(2);
  });

  it('keeps missing quotes missing and enforces portfolio ownership', async () => {
    const f = await fixture(); await transaction(f, 'BUY', '100', '1250');
    const valuation = await service.getPortfolioValuation(f.user.id, f.portfolio.id);
    expect(valuation.missingPriceInstrumentIds).toEqual([f.instrument.id]);
    expect(valuation.quotes).toEqual([{ instrumentId: f.instrument.id, status: 'MISSING' }]);
    await expect(service.getPortfolioValuation(f.otherUser.id, f.portfolio.id)).rejects.toThrow(ApplicationAuthorizationError);
  });

  it('uses the latest fresh quote for market value and unrealized P/L without mutating transactions', async () => {
    const f = await fixture(); await transaction(f, 'BUY', '100', '1250');
    await service.ingestQuote(quote(f, '1200', new Date('2026-08-29T02:00:00.000Z')));
    await service.ingestQuote(quote(f, '1300', new Date('2026-08-29T02:04:00.000Z')));
    const before = await repository.listTransactions(f.portfolio.id); const valuation = await service.getPortfolioValuation(f.user.id, f.portfolio.id);
    expect(valuation.marketValue.toString()).toBe('130000'); expect(valuation.unrealizedPnl.toString()).toBe('5000');
    expect(valuation.quotes[0].status).toBe('FRESH'); expect(await repository.listTransactions(f.portfolio.id)).toEqual(before);
  });

  it('discloses stale quote metadata while retaining an explicitly stale valuation', async () => {
    const f = await fixture(); await transaction(f, 'BUY', '1', '1250');
    const quoteAt = new Date('2026-08-29T01:59:59.999Z'); await service.ingestQuote(quote(f, '1300', quoteAt));
    const valuation = await service.getPortfolioValuation(f.user.id, f.portfolio.id);
    expect(valuation.marketValue.toString()).toBe('1300'); expect(valuation.quotes[0]).toMatchObject({ status: 'STALE', quoteAt, source: 'INTEGRATION_TEST' });
  });

  it('does not let new quotes change realized P/L', async () => {
    const f = await fixture(); await transaction(f, 'BUY', '100', '1250'); await transaction(f, 'SELL', '20', '1400');
    await service.ingestQuote(quote(f, '1300', new Date('2026-08-29T02:04:00.000Z')));
    const valuation = await service.getPortfolioValuation(f.user.id, f.portfolio.id);
    expect(valuation.realizedPnl.toString()).toBe('3000'); expect(valuation.unrealizedPnl.toString()).toBe('4000');
  });

  it('rejects quote currencies that do not match the instrument', async () => {
    const f = await fixture(); await transaction(f, 'BUY', '1', '1250');
    await expect(service.ingestQuote(quote(f, '1300', now, 'USD'))).rejects.toThrow(DomainValidationError);
    expect(await repository.getLatestQuote(f.instrument.id)).toBeUndefined();
    await repository.persistQuote({ instrumentId: f.instrument.id, price: '1300', currency: 'USD', quoteAt: now, receivedAt: now, source: 'BYPASS_TEST' });
    await expect(service.getPortfolioValuation(f.user.id, f.portfolio.id)).rejects.toThrow('currency cannot be mixed');
  });

  it('refreshes through the provider abstraction without provider SDK dependencies', async () => {
    const f = await fixture(); const stored = await service.refreshQuote(f.instrument.id, new FakeMarketDataProvider(() => now));
    expect(stored.price).toBe('1300'); expect(stored.source).toBe('FAKE_DEVELOPMENT');
  });
});
