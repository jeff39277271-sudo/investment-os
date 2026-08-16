import type { Currency } from '@investment-os/shared';
import type { Decimal } from 'decimal.js';

export type Quote = { instrumentId: string; symbol: string; price: Decimal; currency: Currency; market: string; exchange: string; timestamp: Date; source: string };
export interface MarketDataProvider { getQuote(instrumentId: string): Promise<Quote>; }
