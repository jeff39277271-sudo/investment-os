import { randomUUID } from 'node:crypto';
import {
  calculatePositions,
  DomainValidationError,
  summarizePortfolio,
  validateTransaction,
  type Transaction,
} from '@investment-os/domain';
import {
  InvestmentRepository,
  type DraftRecord,
  type TransactionRecord,
} from '@investment-os/db';
import type { ClientSource } from '@investment-os/shared';
import { z } from 'zod';

const uuid = z.string().uuid();
const decimal = z.string().trim().min(1);

export const createTransactionDraftSchema = z.object({
  userId: uuid,
  portfolioId: uuid,
  instrumentId: uuid,
  side: z.enum(['BUY', 'SELL']),
  quantity: decimal,
  price: decimal,
  tradeAt: z.coerce.date(),
  currency: decimal,
  fee: decimal.default('0'),
  tax: decimal.default('0'),
  source: z.enum(['LINE', 'LIFF', 'MOBILE_APP', 'IMPORT', 'MANUAL']),
  idempotencyKey: z.string().trim().min(1),
  expiresAt: z.coerce.date().optional(),
});

export type CreateTransactionDraftInput = z.infer<typeof createTransactionDraftSchema>;

export class ApplicationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplicationConflictError';
  }
}

export class ApplicationAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplicationAuthorizationError';
  }
}

export class TransactionApplicationService {
  constructor(
    private readonly repository: InvestmentRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async createTransactionDraft(input: CreateTransactionDraftInput): Promise<DraftRecord> {
    const parsed = createTransactionDraftSchema.parse(input);
    const existing = await this.repository.findDraftByIdempotency(parsed.userId, parsed.idempotencyKey);
    if (existing) return existing;
    await this.assertPortfolioAccess(parsed.userId, parsed.portfolioId, parsed.instrumentId, parsed.currency);
    const expiresAt = parsed.expiresAt ?? new Date(this.clock().getTime() + 15 * 60 * 1000);
    if (expiresAt.getTime() <= this.clock().getTime()) throw new ApplicationConflictError('draft expiry must be in the future');
    this.validateDraftValues(parsed, randomUUID());
    const draft = await this.repository.createDraft({
      userId: parsed.userId,
      portfolioId: parsed.portfolioId,
      instrumentId: parsed.instrumentId,
      side: parsed.side,
      quantity: parsed.quantity,
      price: parsed.price,
      tradeAt: parsed.tradeAt,
      currency: parsed.currency,
      fee: parsed.fee,
      tax: parsed.tax,
      source: parsed.source,
      expiresAt,
      idempotencyKey: parsed.idempotencyKey,
    });
    return draft;
  }

  async validateDraft(draftId: string, userId: string): Promise<DraftRecord> {
    const draft = await this.requireDraft(draftId, userId);
    if (draft.status === 'DRAFT' && draft.expiresAt.getTime() <= this.clock().getTime()) {
      await this.repository.markDraftExpired(draft.id, userId);
      throw new ApplicationConflictError('draft has expired');
    }
    if (draft.status !== 'DRAFT') throw new ApplicationConflictError(`draft cannot be validated from status ${draft.status}`);
    this.validateDraftValues(draft, draft.id);
    await this.assertSellCapacity(draft);
    return draft;
  }

  async confirmTransaction(draftId: string, userId: string, confirmationIdempotencyKey: string): Promise<TransactionRecord> {
    const draft = await this.requireDraft(draftId, userId);
    if (draft.status === 'CONFIRMED') {
      if (draft.confirmationIdempotencyKey !== confirmationIdempotencyKey) throw new ApplicationConflictError('draft has already been confirmed');
    } else {
      await this.validateDraft(draftId, userId);
    }
    const transactionId = randomUUID();
    const values = this.transactionValues(draft, transactionId);
    return this.repository.confirmDraft(userId, draftId, confirmationIdempotencyKey, values);
  }

  async cancelDraft(draftId: string, userId: string): Promise<DraftRecord> {
    const draft = await this.requireDraft(draftId, userId);
    if (draft.status !== 'DRAFT') throw new ApplicationConflictError(`draft cannot be cancelled from status ${draft.status}`);
    return this.repository.cancelDraft(draftId, userId);
  }

  async voidTransaction(transactionId: string, userId: string): Promise<TransactionRecord> {
    const transaction = await this.requireOwnedTransaction(transactionId, userId);
    return this.repository.voidTransaction(transaction.id);
  }

  async createReversalTransaction(transactionId: string, userId: string, idempotencyKey: string, source: ClientSource = 'MANUAL'): Promise<TransactionRecord> {
    const original = await this.requireOwnedTransaction(transactionId, userId);
    if (original.status !== 'CONFIRMED') throw new ApplicationConflictError('only a confirmed transaction can be reversed');
    const transactions = await this.repository.listTransactions(original.portfolioId);
    const reversal: Transaction = {
      id: randomUUID(),
      portfolioId: original.portfolioId,
      instrumentId: original.instrumentId,
      side: original.side === 'BUY' ? 'SELL' : 'BUY',
      quantity: original.quantity,
      price: original.price,
      currency: original.currency,
      fee: '0',
      tax: '0',
      tradeAt: this.clock(),
      source,
      status: 'CONFIRMED',
      reversalOf: original.id,
      note: `Reversal of ${original.id}`,
      idempotencyKey,
    };
    validateTransaction(reversal);
    calculatePositions(transactions.map((item) => this.toDomainTransaction(item)).concat(reversal), original.portfolioId);
    return this.repository.insertTransaction(reversal);
  }

  private async assertPortfolioAccess(userId: string, portfolioId: string, instrumentId: string, currency: string): Promise<void> {
    const [user, portfolio, instrument] = await Promise.all([
      this.repository.getUser(userId),
      this.repository.getPortfolio(portfolioId),
      this.repository.getInstrument(instrumentId),
    ]);
    if (!user) throw new ApplicationAuthorizationError('user does not exist');
    if (!portfolio || portfolio.userId !== userId) throw new ApplicationAuthorizationError('portfolio does not belong to user');
    if (!instrument) throw new ApplicationConflictError('instrument does not exist');
    if (instrument.currency !== currency || portfolio.baseCurrency !== currency) throw new DomainValidationError('currency must match portfolio and instrument');
  }

  private async assertSellCapacity(draft: DraftRecord): Promise<void> {
    if (draft.side !== 'SELL') return;
    const transactions = await this.repository.listTransactions(draft.portfolioId);
    const position = calculatePositions(transactions.map((item) => this.toDomainTransaction(item)), draft.portfolioId).get(draft.instrumentId);
    if (!position || position.quantity.lt(draft.quantity)) throw new DomainValidationError(`cannot sell ${draft.quantity} when only ${position?.quantity.toString() ?? '0'} is owned`);
  }

  private async requireDraft(draftId: string, userId: string): Promise<DraftRecord> {
    const draft = await this.repository.getDraft(draftId, userId);
    if (!draft) throw new ApplicationAuthorizationError('draft does not belong to user or does not exist');
    return draft;
  }

  private async requireOwnedTransaction(transactionId: string, userId: string): Promise<TransactionRecord> {
    const transaction = await this.repository.getTransaction(transactionId);
    if (!transaction) throw new ApplicationAuthorizationError('transaction does not exist');
    const portfolio = await this.repository.getPortfolio(transaction.portfolioId);
    if (!portfolio || portfolio.userId !== userId) throw new ApplicationAuthorizationError('transaction does not belong to user');
    return transaction;
  }

  private validateDraftValues(values: CreateTransactionDraftInput | DraftRecord, id: string): void {
    validateTransaction({
      id,
      portfolioId: values.portfolioId,
      instrumentId: values.instrumentId,
      side: values.side,
      quantity: values.quantity.toString(),
      price: values.price.toString(),
      currency: values.currency,
      fee: values.fee.toString(),
      tax: values.tax.toString(),
      tradeAt: values.tradeAt,
      source: values.source,
      status: 'CONFIRMED',
      reversalOf: null,
      note: null,
      idempotencyKey: 'draft-validation',
    });
  }

  private transactionValues(draft: DraftRecord, transactionId: string): typeof import('@investment-os/db').transactions.$inferInsert {
    return {
      id: transactionId,
      draftId: draft.id,
      portfolioId: draft.portfolioId,
      instrumentId: draft.instrumentId,
      side: draft.side,
      quantity: draft.quantity,
      price: draft.price,
      currency: draft.currency,
      fee: draft.fee,
      tax: draft.tax,
      tradeAt: draft.tradeAt,
      source: draft.source,
      status: 'CONFIRMED',
      idempotencyKey: `confirmation:${draft.id}`,
    };
  }

  private toDomainTransaction(transaction: TransactionRecord): Transaction {
    return {
      id: transaction.id,
      portfolioId: transaction.portfolioId,
      instrumentId: transaction.instrumentId,
      side: transaction.side,
      quantity: transaction.quantity,
      price: transaction.price,
      currency: transaction.currency,
      fee: transaction.fee,
      tax: transaction.tax,
      tradeAt: transaction.tradeAt,
      source: transaction.source,
      status: transaction.status,
      reversalOf: transaction.reversalOf,
      note: transaction.note,
      idempotencyKey: transaction.idempotencyKey,
    };
  }
}

export { summarizePortfolio };
