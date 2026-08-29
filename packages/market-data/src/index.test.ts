import { describe, expect, it } from 'vitest';
import { createConfiguredMarketDataProvider, FakeMarketDataProvider, MarketDataConfigurationError, QuoteFreshnessPolicy } from './index.js';

const instrument = { id: '00000000-0000-0000-0000-000000000001', symbol: '2330', currency: 'TWD', market: 'TW', exchange: 'TWSE', providerSymbol: '2330' };

describe('market data foundation', () => {
  it('classifies fresh, stale and missing quotes using a configurable policy', () => {
    const policy = new QuoteFreshnessPolicy(60_000); const now = new Date('2026-08-29T02:01:00.000Z');
    expect(policy.classify(instrument.id, { quoteAt: new Date('2026-08-29T02:00:00.000Z'), receivedAt: now, source: 'TEST' }, now).status).toBe('FRESH');
    expect(policy.classify(instrument.id, { quoteAt: new Date('2026-08-29T01:59:59.999Z'), receivedAt: now, source: 'TEST' }, now).status).toBe('STALE');
    expect(policy.classify(instrument.id, undefined, now).status).toBe('MISSING');
  });
  it('returns deterministic Decimal quotes from the fake provider', async () => {
    const now = new Date('2026-08-29T02:00:00.000Z'); const quote = await new FakeMarketDataProvider(() => now).getQuote(instrument);
    expect(quote.price.toString()).toBe('1300'); expect(quote.quoteAt).toEqual(now); expect(quote.source).toBe('FAKE_DEVELOPMENT');
  });
  it('never silently falls back to fake market data in production', () => {
    expect(() => createConfiguredMarketDataProvider({ environment: 'production' })).toThrow(MarketDataConfigurationError);
    expect(() => createConfiguredMarketDataProvider({ environment: 'production', provider: 'FAKE' })).toThrow('forbidden in production');
    expect(createConfiguredMarketDataProvider({ environment: 'development', provider: 'FAKE' })).toBeInstanceOf(FakeMarketDataProvider);
  });
});
