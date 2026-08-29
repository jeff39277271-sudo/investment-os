import { Decimal } from 'decimal.js';
import type { MarketDataInstrument, MarketDataProvider, Quote } from './index.js';

export type FugleErrorCategory = 'AUTH_ERROR' | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'INVALID_PROVIDER_RESPONSE' | 'UNSUPPORTED_INSTRUMENT' | 'TIMEOUT' | 'NETWORK_ERROR';

export class FugleProviderError extends Error {
  constructor(readonly category: FugleErrorCategory, message: string) {
    super(message);
    this.name = 'FugleProviderError';
  }
}

export type MarketDataLogEvent = {
  provider: 'FUGLE'; symbol: string; success: boolean; latencyMs: number; errorCategory?: FugleErrorCategory;
};
export interface MarketDataLogger { log(event: MarketDataLogEvent): void }

export type FugleMarketDataProviderOptions = {
  apiKey: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxConcurrency?: number;
  clock?: () => Date;
  nowMs?: () => number;
  logger?: MarketDataLogger;
  baseUrl?: string;
};

const defaultLogger: MarketDataLogger = { log: (event) => console.log(JSON.stringify(event)) };

function numericToken(raw: string, field: string): string {
  const match = raw.match(new RegExp(`"${field}"\\s*:\\s*(-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`));
  if (!match) throw new FugleProviderError('INVALID_PROVIDER_RESPONSE', `Fugle response is missing numeric ${field}`);
  return match[1];
}

function microsecondsToDate(value: string): Date {
  if (!/^\d+$/.test(value)) throw new FugleProviderError('INVALID_PROVIDER_RESPONSE', 'Fugle lastUpdated must be an integer timestamp');
  const milliseconds = BigInt(value) / 1000n;
  if (milliseconds <= 0n) throw new FugleProviderError('INVALID_PROVIDER_RESPONSE', 'Fugle lastUpdated must be greater than zero');
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) throw new FugleProviderError('INVALID_PROVIDER_RESPONSE', 'Fugle lastUpdated is outside the supported range');
  const date = new Date(Number(milliseconds));
  if (Number.isNaN(date.getTime())) throw new FugleProviderError('INVALID_PROVIDER_RESPONSE', 'Fugle lastUpdated is invalid');
  return date;
}

function validateInstrument(instrument: MarketDataInstrument): void {
  if (!instrument.providerSymbol.trim()) throw new FugleProviderError('UNSUPPORTED_INSTRUMENT', 'instrument has no Fugle provider symbol');
  if (instrument.market !== 'TW' || instrument.currency !== 'TWD' || !['TWSE', 'TPEx'].includes(instrument.exchange)) {
    throw new FugleProviderError('UNSUPPORTED_INSTRUMENT', `instrument ${instrument.symbol} is not supported by Fugle stock quotes`);
  }
}

export class FugleMarketDataProvider implements MarketDataProvider {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxConcurrency: number;
  private readonly clock: () => Date;
  private readonly nowMs: () => number;
  private readonly logger: MarketDataLogger;
  private readonly baseUrl: string;

  constructor(private readonly options: FugleMarketDataProviderOptions) {
    if (!options.apiKey.trim()) throw new FugleProviderError('AUTH_ERROR', 'Fugle API key is required');
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxConcurrency = options.maxConcurrency ?? 4;
    this.clock = options.clock ?? (() => new Date());
    this.nowMs = options.nowMs ?? Date.now;
    this.logger = options.logger ?? defaultLogger;
    this.baseUrl = options.baseUrl ?? 'https://api.fugle.tw/marketdata/v1.0/stock';
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) throw new Error('timeoutMs must be a positive safe integer');
    if (!Number.isSafeInteger(this.maxConcurrency) || this.maxConcurrency <= 0) throw new Error('maxConcurrency must be a positive safe integer');
  }

  async getQuote(instrument: MarketDataInstrument): Promise<Quote> {
    const startedAt = this.nowMs();
    try {
      validateInstrument(instrument);
      const raw = await this.request(instrument);
      const parsed = this.parseResponse(raw, instrument);
      this.logger.log({ provider: 'FUGLE', symbol: instrument.symbol, success: true, latencyMs: Math.max(0, this.nowMs() - startedAt) });
      return parsed;
    } catch (error) {
      const providerError = error instanceof FugleProviderError ? error : new FugleProviderError('NETWORK_ERROR', 'Fugle request failed');
      this.logger.log({ provider: 'FUGLE', symbol: instrument.symbol, success: false, latencyMs: Math.max(0, this.nowMs() - startedAt), errorCategory: providerError.category });
      throw providerError;
    }
  }

  async getQuotes(instruments: readonly MarketDataInstrument[]): Promise<Quote[]> {
    const results = new Array<Quote>(instruments.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(this.maxConcurrency, instruments.length) }, async () => {
      while (nextIndex < instruments.length) {
        const index = nextIndex++;
        results[index] = await this.getQuote(instruments[index]);
      }
    });
    await Promise.all(workers);
    return results;
  }

  private async request(instrument: MarketDataInstrument): Promise<string> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { controller.abort(); reject(new FugleProviderError('TIMEOUT', 'Fugle request timed out')); }, this.timeoutMs);
    });
    try {
      const requestPromise = this.fetcher(`${this.baseUrl}/intraday/quote/${encodeURIComponent(instrument.providerSymbol)}`, {
        method: 'GET', headers: { 'X-API-KEY': this.options.apiKey, accept: 'application/json' }, signal: controller.signal,
      }).catch((error: unknown) => {
        if (controller.signal.aborted) throw new FugleProviderError('TIMEOUT', 'Fugle request timed out');
        throw new FugleProviderError('NETWORK_ERROR', error instanceof Error ? 'Fugle network request failed' : 'Fugle request failed');
      });
      const response = await Promise.race([requestPromise, timeoutPromise]);
      if (response.status === 401 || response.status === 403) throw new FugleProviderError('AUTH_ERROR', 'Fugle authentication failed');
      if (response.status === 429) throw new FugleProviderError('RATE_LIMITED', 'Fugle rate limit exceeded');
      if (response.status === 404) throw new FugleProviderError('UNSUPPORTED_INSTRUMENT', `Fugle quote is unavailable for ${instrument.symbol}`);
      if (!response.ok) throw new FugleProviderError(response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'INVALID_PROVIDER_RESPONSE', `Fugle returned HTTP ${response.status}`);
      return await response.text();
    } finally { if (timeout) clearTimeout(timeout); }
  }

  private parseResponse(raw: string, instrument: MarketDataInstrument): Quote {
    let body: unknown;
    try { body = JSON.parse(raw); }
    catch { throw new FugleProviderError('INVALID_PROVIDER_RESPONSE', 'Fugle returned invalid JSON'); }
    if (!body || typeof body !== 'object') throw new FugleProviderError('INVALID_PROVIDER_RESPONSE', 'Fugle response must be an object');
    const value = body as Record<string, unknown>;
    if (typeof value.symbol !== 'string' || value.symbol !== instrument.providerSymbol) throw new FugleProviderError('INVALID_PROVIDER_RESPONSE', 'Fugle response symbol does not match the requested instrument');
    if (typeof value.exchange !== 'string' || value.exchange !== instrument.exchange) throw new FugleProviderError('INVALID_PROVIDER_RESPONSE', 'Fugle response exchange does not match the instrument');
    if (typeof value.lastPrice !== 'number') throw new FugleProviderError('INVALID_PROVIDER_RESPONSE', 'Fugle response is missing numeric lastPrice');
    if (typeof value.lastUpdated !== 'number') throw new FugleProviderError('INVALID_PROVIDER_RESPONSE', 'Fugle response is missing numeric lastUpdated');
    const rawPrice = numericToken(raw, 'lastPrice');
    let price: Decimal;
    try { price = new Decimal(rawPrice); }
    catch { throw new FugleProviderError('INVALID_PROVIDER_RESPONSE', 'Fugle lastPrice is invalid'); }
    if (!price.isFinite() || price.lte(0)) throw new FugleProviderError('INVALID_PROVIDER_RESPONSE', 'Fugle lastPrice must be greater than zero');
    const quoteAt = microsecondsToDate(numericToken(raw, 'lastUpdated'));
    return { instrumentId: instrument.id, symbol: instrument.symbol, price, currency: instrument.currency, quoteAt, receivedAt: this.clock(), source: 'FUGLE' };
  }
}
