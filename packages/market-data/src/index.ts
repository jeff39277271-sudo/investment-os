import { Decimal } from 'decimal.js';
import type { Currency } from '@investment-os/shared';

export type MarketDataInstrument = { id: string; symbol: string; currency: Currency; market: string; exchange: string; providerSymbol: string };
export type Quote = { instrumentId: string; symbol: string; price: Decimal; currency: Currency; quoteAt: Date; receivedAt: Date; source: string };
export interface MarketDataProvider {
  getQuote(instrument: MarketDataInstrument): Promise<Quote>;
  getQuotes(instruments: readonly MarketDataInstrument[]): Promise<Quote[]>;
}

export type QuoteStatus = 'FRESH' | 'STALE' | 'MISSING';
export type QuoteFreshness = { instrumentId: string; status: QuoteStatus; quoteAt?: Date; receivedAt?: Date; source?: string };

export class QuoteFreshnessPolicy {
  constructor(readonly staleAfterMs: number) {
    if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs <= 0) throw new Error('staleAfterMs must be a positive safe integer');
  }
  classify(instrumentId: string, quote: Pick<Quote, 'quoteAt' | 'receivedAt' | 'source'> | undefined, now: Date): QuoteFreshness {
    if (!quote) return { instrumentId, status: 'MISSING' };
    return { instrumentId, status: now.getTime() - quote.quoteAt.getTime() <= this.staleAfterMs ? 'FRESH' : 'STALE', quoteAt: quote.quoteAt, receivedAt: quote.receivedAt, source: quote.source };
  }
}

export class MarketDataConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = 'MarketDataConfigurationError'; }
}

export class FakeMarketDataProvider implements MarketDataProvider {
  private readonly prices = new Map([['2330', { price: '1300', currency: 'TWD' }], ['0050', { price: '60', currency: 'TWD' }]]);
  constructor(private readonly clock: () => Date = () => new Date()) {}
  async getQuote(instrument: MarketDataInstrument): Promise<Quote> {
    const configured = this.prices.get(instrument.symbol);
    if (!configured) throw new MarketDataConfigurationError(`fake quote is not configured for ${instrument.symbol}`);
    if (configured.currency !== instrument.currency) throw new MarketDataConfigurationError(`fake quote currency does not match ${instrument.symbol}`);
    const timestamp = this.clock();
    return { instrumentId: instrument.id, symbol: instrument.symbol, price: new Decimal(configured.price), currency: configured.currency, quoteAt: timestamp, receivedAt: timestamp, source: 'FAKE_DEVELOPMENT' };
  }
  getQuotes(instruments: readonly MarketDataInstrument[]): Promise<Quote[]> { return Promise.all(instruments.map((instrument) => this.getQuote(instrument))); }
}

export function createConfiguredMarketDataProvider(config: { environment: string; provider?: string; clock?: () => Date }): MarketDataProvider {
  if (!config.provider) throw new MarketDataConfigurationError('market data provider is not configured');
  if (config.provider !== 'FAKE') throw new MarketDataConfigurationError(`unsupported market data provider: ${config.provider}`);
  if (config.environment === 'production') throw new MarketDataConfigurationError('fake market data provider is forbidden in production');
  return new FakeMarketDataProvider(config.clock);
}
