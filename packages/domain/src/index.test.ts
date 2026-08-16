import { describe, expect, it } from 'vitest';
import { DomainValidationError, summarizePortfolio, calculatePositions } from './index.js';

const portfolioId = '00000000-0000-0000-0000-000000000001';
const instrumentId = '00000000-0000-0000-0000-000000000002';
const tx = (id: string, side: 'BUY' | 'SELL', quantity: string, price: string, extra: Partial<Record<string, unknown>> = {}) => ({
  id: `00000000-0000-0000-0000-${id.padStart(12, '0')}`,
  portfolioId, instrumentId, side, quantity, price, currency: 'TWD', fee: '0', tax: '0',
  tradeAt: new Date('2026-01-01T00:00:00Z'), source: 'MANUAL' as const, status: 'CONFIRMED' as const, idempotencyKey: id, ...extra,
});

describe('portfolio calculator', () => {
  it('calculates first buy', () => {
    const [position] = [...calculatePositions([tx('1', 'BUY', '10', '100')]).values()];
    expect(position.quantity.toString()).toBe('10');
    expect(position.averageCost.toString()).toBe('100');
  });
  it('calculates weighted average across buys', () => {
    const [position] = [...calculatePositions([tx('1', 'BUY', '10', '100'), tx('2', 'BUY', '5', '130')]).values()];
    expect(position.averageCost.toString()).toBe('110');
  });
  it('calculates partial and full sells with realized P/L', () => {
    const partial = calculatePositions([tx('1', 'BUY', '10', '100'), tx('2', 'SELL', '4', '120', { fee: '2', tax: '1' })]).get(instrumentId)!;
    expect(partial.quantity.toString()).toBe('6');
    expect(partial.realizedPnl.toString()).toBe('77');
    const full = calculatePositions([tx('1', 'BUY', '10', '100'), tx('2', 'SELL', '10', '120')]).get(instrumentId)!;
    expect(full.quantity.toString()).toBe('0');
    expect(full.averageCost.toString()).toBe('0');
  });
  it('rejects oversell', () => {
    expect(() => calculatePositions([tx('1', 'BUY', '1', '100'), tx('2', 'SELL', '2', '120')])).toThrow(DomainValidationError);
  });
  it('includes buy fees and taxes in cost basis without floating point drift', () => {
    const [position] = [...calculatePositions([tx('1', 'BUY', '0.1', '0.3', { fee: '0.01', tax: '0.02' })]).values()];
    expect(position.costBasis.toString()).toBe('0.06');
    expect(position.averageCost.toString()).toBe('0.6');
  });
  it('ignores voided transactions and supports reversal records', () => {
    const transactions = [tx('1', 'BUY', '10', '100'), tx('2', 'BUY', '5', '200', { status: 'VOIDED', reversalOf: tx('1', 'BUY', '10', '100').id })];
    const summary = summarizePortfolio(portfolioId, 'TWD', transactions, new Map([[instrumentId, '110']]));
    expect(summary.positions[0].quantity.toString()).toBe('10');
    expect(summary.unrealizedPnl.toString()).toBe('100');
  });
  it('applies a confirmed reversal as a normal compensating ledger entry', () => {
    const original = tx('1', 'BUY', '10', '100');
    const reversal = tx('2', 'SELL', '10', '100', { reversalOf: original.id });
    const [position] = [...calculatePositions([original, reversal]).values()];
    expect(position.quantity.toString()).toBe('0');
    expect(position.costBasis.toString()).toBe('0');
    expect(position.realizedPnl.toString()).toBe('0');
  });
  it('does not fabricate market value when a quote is missing', () => {
    const summary = summarizePortfolio(portfolioId, 'TWD', [tx('1', 'BUY', '2', '100')]);
    expect(summary.totalCost.toString()).toBe('200');
    expect(summary.marketValue.toString()).toBe('0');
    expect(summary.unrealizedPnl.toString()).toBe('0');
    expect(summary.missingPriceInstrumentIds).toEqual([instrumentId]);
  });
  it('processes transactions in trade-time order', () => {
    const buy = tx('1', 'BUY', '1', '100', { tradeAt: new Date('2026-01-02T00:00:00Z') });
    const sell = tx('2', 'SELL', '1', '120', { tradeAt: new Date('2026-01-03T00:00:00Z') });
    expect(() => calculatePositions([sell, buy])).not.toThrow();
    expect(calculatePositions([sell, buy]).get(instrumentId)?.realizedPnl.toString()).toBe('20');
  });
});
