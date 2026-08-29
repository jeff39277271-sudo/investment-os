import { describe, expect, it, vi } from 'vitest';
import {
  createConfiguredMarketDataProvider,
  FugleMarketDataProvider,
  FugleProviderError,
  MarketDataConfigurationError,
  type MarketDataInstrument,
  type MarketDataLogEvent,
} from './index.js';

const instrument: MarketDataInstrument = {
  id: '00000000-0000-0000-0000-000000000001',
  symbol: '2330',
  currency: 'TWD',
  market: 'TW',
  exchange: 'TWSE',
  providerSymbol: 'FUGLE-2330',
};

function response(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

function quoteBody(symbol = instrument.providerSymbol, overrides = ''): string {
  return `{"symbol":"${symbol}","exchange":"TWSE","lastPrice":1300.123456789123,"lastUpdated":1685338200000000${overrides}}`;
}

async function category(promise: Promise<unknown>): Promise<string | undefined> {
  try { await promise; return undefined; }
  catch (error) { return error instanceof FugleProviderError ? error.category : undefined; }
}

describe('FugleMarketDataProvider', () => {
  it('maps providerSymbol, exact Decimal price, source, quoteAt and receivedAt', async () => {
    const receivedAt = new Date('2026-08-29T02:00:00.000Z');
    const fetcher = vi.fn<typeof fetch>(async () => response(quoteBody()));
    const quote = await new FugleMarketDataProvider({ apiKey: 'test-key', fetcher, clock: () => receivedAt, logger: { log() {} } }).getQuote(instrument);

    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/FUGLE-2330');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', headers: { 'X-API-KEY': 'test-key', accept: 'application/json' } });
    expect(quote).toMatchObject({ instrumentId: instrument.id, symbol: '2330', currency: 'TWD', source: 'FUGLE', quoteAt: new Date(1_685_338_200_000), receivedAt });
    expect(quote.price.toString()).toBe('1300.123456789123');
  });

  it.each([
    ['invalid JSON', '{', 'INVALID_PROVIDER_RESPONSE'],
    ['missing price', '{"symbol":"FUGLE-2330","exchange":"TWSE","lastUpdated":1685338200000000}', 'INVALID_PROVIDER_RESPONSE'],
    ['zero price', '{"symbol":"FUGLE-2330","exchange":"TWSE","lastPrice":0,"lastUpdated":1685338200000000}', 'INVALID_PROVIDER_RESPONSE'],
    ['negative price', '{"symbol":"FUGLE-2330","exchange":"TWSE","lastPrice":-1,"lastUpdated":1685338200000000}', 'INVALID_PROVIDER_RESPONSE'],
    ['missing timestamp', '{"symbol":"FUGLE-2330","exchange":"TWSE","lastPrice":1}', 'INVALID_PROVIDER_RESPONSE'],
    ['invalid timestamp', '{"symbol":"FUGLE-2330","exchange":"TWSE","lastPrice":1,"lastUpdated":0}', 'INVALID_PROVIDER_RESPONSE'],
    ['wrong symbol', quoteBody('0050'), 'INVALID_PROVIDER_RESPONSE'],
    ['wrong exchange', '{"symbol":"FUGLE-2330","exchange":"TPEx","lastPrice":1,"lastUpdated":1685338200000000}', 'INVALID_PROVIDER_RESPONSE'],
  ])('rejects %s', async (_label, body, expected) => {
    const provider = new FugleMarketDataProvider({ apiKey: 'key', fetcher: (async () => response(body)) as typeof fetch, logger: { log() {} } });
    expect(await category(provider.getQuote(instrument))).toBe(expected);
  });

  it.each([
    [401, 'AUTH_ERROR'], [403, 'AUTH_ERROR'], [404, 'UNSUPPORTED_INSTRUMENT'], [429, 'RATE_LIMITED'], [500, 'PROVIDER_UNAVAILABLE'], [400, 'INVALID_PROVIDER_RESPONSE'],
  ])('maps HTTP %s to %s', async (status, expected) => {
    const provider = new FugleMarketDataProvider({ apiKey: 'key', fetcher: (async () => response('{}', status)) as typeof fetch, logger: { log() {} } });
    expect(await category(provider.getQuote(instrument))).toBe(expected);
  });

  it('classifies timeouts and network failures without exposing the API key', async () => {
    const events: MarketDataLogEvent[] = [];
    const timeoutProvider = new FugleMarketDataProvider({ apiKey: 'super-secret-key', timeoutMs: 5, fetcher: (() => new Promise<Response>(() => {})) as typeof fetch, logger: { log: (event) => events.push(event) } });
    const networkProvider = new FugleMarketDataProvider({ apiKey: 'super-secret-key', fetcher: (async () => { throw new Error('super-secret-key'); }) as typeof fetch, logger: { log: (event) => events.push(event) } });

    await expect(timeoutProvider.getQuote(instrument)).rejects.toMatchObject({ category: 'TIMEOUT', message: 'Fugle request timed out' });
    await expect(networkProvider.getQuote(instrument)).rejects.toMatchObject({ category: 'NETWORK_ERROR', message: 'Fugle network request failed' });
    expect(JSON.stringify(events)).not.toContain('super-secret-key');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'FUGLE', symbol: '2330', success: false, errorCategory: 'TIMEOUT' }),
      expect.objectContaining({ provider: 'FUGLE', symbol: '2330', success: false, errorCategory: 'NETWORK_ERROR' }),
    ]));
  });

  it('rejects unsupported instrument metadata before making a request', async () => {
    const fetcher = vi.fn();
    const provider = new FugleMarketDataProvider({ apiKey: 'key', fetcher: fetcher as typeof fetch, logger: { log() {} } });
    expect(await category(provider.getQuote({ ...instrument, providerSymbol: '' }))).toBe('UNSUPPORTED_INSTRUMENT');
    expect(await category(provider.getQuote({ ...instrument, market: 'US', currency: 'USD' }))).toBe('UNSUPPORTED_INSTRUMENT');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('limits batch request concurrency and preserves input order', async () => {
    let active = 0; let maximum = 0;
    const fetcher = (async (input: string | URL | Request) => {
      active += 1; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const symbol = decodeURIComponent(String(input).split('/').at(-1) ?? '');
      return response(quoteBody(symbol));
    }) as typeof fetch;
    const instruments = Array.from({ length: 5 }, (_, index) => ({ ...instrument, id: `id-${index}`, symbol: `internal-${index}`, providerSymbol: `provider-${index}` }));
    const quotes = await new FugleMarketDataProvider({ apiKey: 'key', maxConcurrency: 2, fetcher, logger: { log() {} } }).getQuotes(instruments);
    expect(maximum).toBe(2);
    expect(quotes.map((quote) => quote.symbol)).toEqual(instruments.map(({ symbol }) => symbol));
  });
});

describe('market data provider configuration', () => {
  it('requires an explicit provider and Fugle API key', () => {
    expect(() => createConfiguredMarketDataProvider({ environment: 'development' })).toThrow(MarketDataConfigurationError);
    expect(() => createConfiguredMarketDataProvider({ environment: 'development', provider: 'none' })).toThrow('disabled');
    expect(() => createConfiguredMarketDataProvider({ environment: 'production', provider: 'fugle' })).toThrow('FUGLE_API_KEY');
  });

  it('creates Fugle only when explicitly configured and never falls back to fake in production', () => {
    expect(createConfiguredMarketDataProvider({ environment: 'production', provider: 'fugle', apiKey: 'key', logger: { log() {} } })).toBeInstanceOf(FugleMarketDataProvider);
    expect(() => createConfiguredMarketDataProvider({ environment: 'production', provider: 'fake' })).toThrow('forbidden in production');
    expect(() => createConfiguredMarketDataProvider({ environment: 'production', provider: 'unknown' })).toThrow('unsupported');
  });
});
