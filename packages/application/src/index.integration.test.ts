import { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { createDb, InvestmentRepository, type TransactionRecord } from '@investment-os/db';
import { summarizePortfolio } from '@investment-os/domain';
import { ApplicationAuthorizationError, ApplicationConflictError, TransactionApplicationService } from './index.js';

const integration = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://investment:investment@localhost:5432/investment_os';
const pool = new Pool({ connectionString: databaseUrl });
const db = createDb(pool);
const repository = new InvestmentRepository(db);
let now = new Date('2026-08-16T00:00:00.000Z');
const service = new TransactionApplicationService(repository, () => now);

async function fixture() {
  const user = await repository.createUser({ displayName: 'Integration User' });
  const otherUser = await repository.createUser({ displayName: 'Other User' });
  const portfolio = await repository.createPortfolio({ userId: user.id, name: 'Main', baseCurrency: 'TWD' });
  const otherPortfolio = await repository.createPortfolio({ userId: otherUser.id, name: 'Other', baseCurrency: 'TWD' });
  const instrument = await repository.createInstrument({ symbol: '2330', name: 'TSMC', exchange: 'TWSE', market: 'TW', currency: 'TWD', assetType: 'EQUITY', providerSymbol: 'TWSE:2330' });
  return { user, otherUser, portfolio, otherPortfolio, instrument };
}

async function draft(input: Parameters<TransactionApplicationService['createTransactionDraft']>[0]) {
  return service.createTransactionDraft({ ...input, tradeAt: input.tradeAt ?? now, source: input.source ?? 'MANUAL' });
}

function base(input: Awaited<ReturnType<typeof fixture>>) {
  return { userId: input.user.id, portfolioId: input.portfolio.id, instrumentId: input.instrument.id, currency: 'TWD', fee: '0', tax: '0', source: 'MANUAL' as const, tradeAt: now };
}

function toDomain(transaction: TransactionRecord) {
  return { id: transaction.id, portfolioId: transaction.portfolioId, instrumentId: transaction.instrumentId, side: transaction.side, quantity: transaction.quantity, price: transaction.price, currency: transaction.currency, fee: transaction.fee, tax: transaction.tax, tradeAt: transaction.tradeAt, createdAt: transaction.createdAt, source: transaction.source, status: transaction.status, reversalOf: transaction.reversalOf, note: transaction.note, idempotencyKey: transaction.idempotencyKey } as const;
}

integration('PostgreSQL persistence and application safety', () => {
  beforeAll(async () => {
    await pool.query('SELECT 1');
  });
  beforeEach(async () => {
    now = new Date('2026-08-16T00:00:00.000Z');
    await pool.query('TRUNCATE TABLE transactions, transaction_drafts, position_snapshots, instruments, portfolios, user_identities, users CASCADE');
  });
  afterAll(async () => pool.end());

  it('creates user and portfolio, drafts and confirms a BUY', async () => {
    const f = await fixture();
    const d = await draft({ ...base(f), side: 'BUY', quantity: '10', price: '100', fee: '2', tax: '1', idempotencyKey: 'buy-1' });
    const transaction = await service.confirmTransaction(d.id, f.user.id, 'confirm-1');
    expect(transaction.side).toBe('BUY');
    expect(transaction.quantity).toBe('10');
  });

  it('supports multiple BUYs, partial SELL and full SELL', async () => {
    const f = await fixture();
    for (const [key, quantity, price] of [['b1', '10', '100'], ['b2', '5', '130']] as const) {
      const d = await draft({ ...base(f), side: 'BUY', quantity, price, idempotencyKey: key });
      await service.confirmTransaction(d.id, f.user.id, `c-${key}`);
    }
    const partial = await draft({ ...base(f), side: 'SELL', quantity: '4', price: '150', idempotencyKey: 's1' });
    await service.confirmTransaction(partial.id, f.user.id, 'c-s1');
    const full = await draft({ ...base(f), side: 'SELL', quantity: '11', price: '150', idempotencyKey: 's2' });
    await service.confirmTransaction(full.id, f.user.id, 'c-s2');
    const transactions = await repository.listTransactions(f.portfolio.id);
    const summary = summarizePortfolio(f.portfolio.id, 'TWD', transactions.map(toDomain), new Map([[f.instrument.id, '150']]));
    expect(summary.positions[0].quantity.toString()).toBe('0');
    // Cost = 10×100 + 5×130 = 1,650; proceeds = 15×150 = 2,250; realized P/L = 600.
    expect(summary.realizedPnl.toString()).toBe('600');
  });

  it('rejects oversell during draft validation', async () => {
    const f = await fixture();
    const d = await draft({ ...base(f), side: 'SELL', quantity: '1', price: '100', idempotencyKey: 'oversell' });
    await expect(service.confirmTransaction(d.id, f.user.id, 'confirm-oversell')).rejects.toThrow('cannot sell');
  });

  it('protects duplicate confirmation with idempotency', async () => {
    const f = await fixture();
    const d = await draft({ ...base(f), side: 'BUY', quantity: '1', price: '100', idempotencyKey: 'duplicate' });
    const first = await service.confirmTransaction(d.id, f.user.id, 'same-key');
    const replay = await service.confirmTransaction(d.id, f.user.id, 'same-key');
    expect(replay.id).toBe(first.id);
    await expect(service.confirmTransaction(d.id, f.user.id, 'different-key')).rejects.toThrow(ApplicationConflictError);
    expect((await repository.listTransactions(f.portfolio.id))).toHaveLength(1);
  });

  it('rejects expired and cancelled drafts', async () => {
    const f = await fixture();
    const expired = await draft({ ...base(f), side: 'BUY', quantity: '1', price: '100', idempotencyKey: 'expired', expiresAt: new Date(now.getTime() + 1000) });
    now = new Date(now.getTime() + 2000);
    await expect(service.confirmTransaction(expired.id, f.user.id, 'confirm-expired')).rejects.toThrow('expired');
    now = new Date('2026-08-16T00:00:00.000Z');
    const cancelled = await draft({ ...base(f), side: 'BUY', quantity: '1', price: '100', idempotencyKey: 'cancelled' });
    await service.cancelDraft(cancelled.id, f.user.id);
    await expect(service.confirmTransaction(cancelled.id, f.user.id, 'confirm-cancelled')).rejects.toThrow(ApplicationConflictError);
  });

  it('supports void and reversal without deleting the ledger row', async () => {
    const f = await fixture();
    const d = await draft({ ...base(f), side: 'BUY', quantity: '2', price: '100', idempotencyKey: 'void-me' });
    const transaction = await service.confirmTransaction(d.id, f.user.id, 'confirm-void');
    const voided = await service.voidTransaction(transaction.id, f.user.id);
    expect(voided.status).toBe('VOIDED');
    const d2 = await draft({ ...base(f), side: 'BUY', quantity: '2', price: '100', idempotencyKey: 'reverse-me' });
    const original = await service.confirmTransaction(d2.id, f.user.id, 'confirm-reverse');
    const reversal = await service.createReversalTransaction(original.id, f.user.id, 'reverse-key');
    expect(reversal.reversalOf).toBe(original.id);
    expect((await repository.listTransactions(f.portfolio.id))).toHaveLength(3);
  });

  it('enforces ownership for drafts and transactions', async () => {
    const f = await fixture();
    const d = await draft({ ...base(f), side: 'BUY', quantity: '1', price: '100', idempotencyKey: 'owned' });
    await expect(service.confirmTransaction(d.id, f.otherUser.id, 'wrong-user')).rejects.toThrow(ApplicationAuthorizationError);
    const tx = await service.confirmTransaction(d.id, f.user.id, 'right-user');
    await expect(service.voidTransaction(tx.id, f.otherUser.id)).rejects.toThrow(ApplicationAuthorizationError);
    expect(f.otherPortfolio.userId).toBe(f.otherUser.id);
  });
});
