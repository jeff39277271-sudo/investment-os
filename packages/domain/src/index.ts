import { Decimal } from 'decimal.js';
import { z } from 'zod';
import type { Currency } from '@investment-os/shared';

export { Decimal };

const decimalString = z.string().trim().min(1);

export const transactionInputSchema = z.object({
  id: z.string().uuid().optional(),
  portfolioId: z.string().uuid(),
  instrumentId: z.string().uuid(),
  side: z.enum(['BUY', 'SELL']),
  quantity: decimalString,
  price: decimalString,
  currency: decimalString,
  fee: decimalString.default('0'),
  tax: decimalString.default('0'),
  tradeAt: z.coerce.date(),
  source: z.enum(['LINE', 'LIFF', 'MOBILE_APP', 'IMPORT', 'MANUAL']),
  status: z.enum(['CONFIRMED', 'VOIDED']).default('CONFIRMED'),
  reversalOf: z.string().uuid().nullable().optional(),
  note: z.string().nullable().optional(),
  createdAt: z.coerce.date().optional(),
  idempotencyKey: z.string().trim().min(1),
});

export type TransactionInput = z.infer<typeof transactionInputSchema>;
export type Transaction = TransactionInput & { id: string };

export type Position = {
  instrumentId: string;
  quantity: Decimal;
  averageCost: Decimal;
  costBasis: Decimal;
  realizedPnl: Decimal;
  lastPrice?: Decimal;
  marketValue?: Decimal;
  unrealizedPnl?: Decimal;
};

export type PortfolioSummary = {
  portfolioId: string;
  baseCurrency: Currency;
  totalCost: Decimal;
  marketValue: Decimal;
  realizedPnl: Decimal;
  unrealizedPnl: Decimal;
  missingPriceInstrumentIds: string[];
  positions: Position[];
};

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

function parseDecimal(value: string, field: string): Decimal {
  try {
    const decimal = new Decimal(value);
    if (!decimal.isFinite()) throw new Error('not finite');
    return decimal;
  } catch {
    throw new DomainValidationError(`${field} must be a valid decimal`);
  }
}

function positive(value: string, field: string): Decimal {
  const decimal = parseDecimal(value, field);
  if (decimal.lte(0)) throw new DomainValidationError(`${field} must be greater than zero`);
  return decimal;
}

function nonNegative(value: string, field: string): Decimal {
  const decimal = parseDecimal(value, field);
  if (decimal.lt(0)) throw new DomainValidationError(`${field} must not be negative`);
  return decimal;
}

export function validateTransaction(input: TransactionInput): TransactionInput {
  const parsed = transactionInputSchema.parse(input);
  positive(parsed.quantity, 'quantity');
  positive(parsed.price, 'price');
  nonNegative(parsed.fee, 'fee');
  nonNegative(parsed.tax, 'tax');
  if (Number.isNaN(parsed.tradeAt.getTime())) throw new DomainValidationError('tradeAt must be a valid date');
  if (parsed.reversalOf === parsed.id) throw new DomainValidationError('transaction cannot reverse itself');
  return parsed;
}

function newPosition(instrumentId: string): Position {
  return { instrumentId, quantity: new Decimal(0), averageCost: new Decimal(0), costBasis: new Decimal(0), realizedPnl: new Decimal(0) };
}

/** Rebuilds positions from the confirmed transaction ledger. */
export function calculatePositions(transactions: readonly Transaction[], portfolioId?: string): Map<string, Position> {
  const active = transactions
    .filter((transaction) => transaction.status === 'CONFIRMED')
    .sort((left, right) => {
      const tradeAt = left.tradeAt.getTime() - right.tradeAt.getTime();
      if (tradeAt !== 0) return tradeAt;
      const createdAt = (left.createdAt?.getTime() ?? 0) - (right.createdAt?.getTime() ?? 0);
      if (createdAt !== 0) return createdAt;
      return left.id.localeCompare(right.id);
    });
  const positions = new Map<string, Position>();
  for (const transaction of active) {
    if (portfolioId !== undefined && transaction.portfolioId !== portfolioId) {
      throw new DomainValidationError('all transactions must belong to the requested portfolio');
    }
    const input = validateTransaction(transaction);
    const quantity = positive(input.quantity, 'quantity');
    const price = positive(input.price, 'price');
    const fee = nonNegative(input.fee, 'fee');
    const tax = nonNegative(input.tax, 'tax');
    const position = positions.get(input.instrumentId) ?? newPosition(input.instrumentId);

    if (input.side === 'BUY') {
      position.costBasis = position.costBasis.add(quantity.mul(price).add(fee).add(tax));
      position.quantity = position.quantity.add(quantity);
      position.averageCost = position.costBasis.div(position.quantity);
    } else {
      if (quantity.gt(position.quantity)) throw new DomainValidationError(`cannot sell ${quantity.toString()} when only ${position.quantity.toString()} is owned`);
      position.realizedPnl = position.realizedPnl.add(quantity.mul(price.sub(position.averageCost)).sub(fee).sub(tax));
      position.quantity = position.quantity.sub(quantity);
      position.costBasis = position.averageCost.mul(position.quantity);
      if (position.quantity.isZero()) position.averageCost = new Decimal(0);
    }
    positions.set(input.instrumentId, position);
  }
  return positions;
}

export function summarizePortfolio(
  portfolioId: string,
  baseCurrency: Currency,
  transactions: readonly Transaction[],
  prices: ReadonlyMap<string, string | Decimal> = new Map(),
): PortfolioSummary {
  const calculated = [...calculatePositions(transactions, portfolioId).values()];
  const missingPriceInstrumentIds: string[] = [];
  const positions = calculated.map((position) => {
    const rawPrice = prices.get(position.instrumentId);
    if (rawPrice === undefined) {
      missingPriceInstrumentIds.push(position.instrumentId);
      return position;
    }
    const lastPrice = positive(rawPrice.toString(), `price for ${position.instrumentId}`);
    const marketValue = position.quantity.mul(lastPrice);
    return { ...position, lastPrice, marketValue, unrealizedPnl: marketValue.sub(position.costBasis) };
  });

  return {
    portfolioId,
    baseCurrency,
    totalCost: positions.reduce((sum, position) => sum.add(position.costBasis), new Decimal(0)),
    marketValue: positions.reduce((sum, position) => sum.add(position.marketValue ?? new Decimal(0)), new Decimal(0)),
    realizedPnl: positions.reduce((sum, position) => sum.add(position.realizedPnl), new Decimal(0)),
    unrealizedPnl: positions.reduce((sum, position) => sum.add(position.unrealizedPnl ?? new Decimal(0)), new Decimal(0)),
    missingPriceInstrumentIds,
    positions,
  };
}
