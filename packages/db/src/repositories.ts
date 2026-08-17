import { and, asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Decimal } from 'decimal.js';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;
export type UserRecord = typeof schema.users.$inferSelect;
export type UserIdentityRecord = typeof schema.userIdentities.$inferSelect;
export type PortfolioRecord = typeof schema.portfolios.$inferSelect;
export type InstrumentRecord = typeof schema.instruments.$inferSelect;
export type DraftRecord = typeof schema.transactionDrafts.$inferSelect;
export type TransactionRecord = typeof schema.transactions.$inferSelect;

export class RepositoryNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepositoryNotFoundError';
  }
}

export class RepositoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepositoryConflictError';
  }
}

function canonicalDecimal(value: string): string {
  return new Decimal(value).toString();
}

function normalizeDraft(record: DraftRecord): DraftRecord {
  return {
    ...record,
    quantity: canonicalDecimal(record.quantity),
    price: canonicalDecimal(record.price),
    fee: canonicalDecimal(record.fee),
    tax: canonicalDecimal(record.tax),
  };
}

function normalizeTransaction(record: TransactionRecord): TransactionRecord {
  return {
    ...record,
    quantity: canonicalDecimal(record.quantity),
    price: canonicalDecimal(record.price),
    fee: canonicalDecimal(record.fee),
    tax: canonicalDecimal(record.tax),
  };
}

export class InvestmentRepository {
  constructor(private readonly db: Database) {}

  async createUser(values: typeof schema.users.$inferInsert): Promise<UserRecord> {
    const [user] = await this.db.insert(schema.users).values(values).returning();
    return user;
  }

  async getUser(userId: string): Promise<UserRecord | undefined> {
    const [user] = await this.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    return user;
  }

  async createUserIdentity(values: typeof schema.userIdentities.$inferInsert): Promise<UserIdentityRecord> {
    const [identity] = await this.db.insert(schema.userIdentities).values(values).returning();
    return identity;
  }

  async createPortfolio(values: typeof schema.portfolios.$inferInsert): Promise<PortfolioRecord> {
    const [portfolio] = await this.db.insert(schema.portfolios).values(values).returning();
    return portfolio;
  }

  async getPortfolio(portfolioId: string): Promise<PortfolioRecord | undefined> {
    const [portfolio] = await this.db.select().from(schema.portfolios).where(eq(schema.portfolios.id, portfolioId)).limit(1);
    return portfolio;
  }

  async createInstrument(values: typeof schema.instruments.$inferInsert): Promise<InstrumentRecord> {
    const [instrument] = await this.db.insert(schema.instruments).values(values).returning();
    return instrument;
  }

  async getInstrument(instrumentId: string): Promise<InstrumentRecord | undefined> {
    const [instrument] = await this.db.select().from(schema.instruments).where(eq(schema.instruments.id, instrumentId)).limit(1);
    return instrument;
  }

  async findDraftByIdempotency(userId: string, idempotencyKey: string): Promise<DraftRecord | undefined> {
    const [draft] = await this.db.select().from(schema.transactionDrafts).where(and(eq(schema.transactionDrafts.userId, userId), eq(schema.transactionDrafts.idempotencyKey, idempotencyKey))).limit(1);
    return draft ? normalizeDraft(draft) : undefined;
  }

  async getDraft(draftId: string, userId: string): Promise<DraftRecord | undefined> {
    const [draft] = await this.db.select().from(schema.transactionDrafts).where(and(eq(schema.transactionDrafts.id, draftId), eq(schema.transactionDrafts.userId, userId))).limit(1);
    return draft ? normalizeDraft(draft) : undefined;
  }

  async createDraft(values: typeof schema.transactionDrafts.$inferInsert): Promise<DraftRecord> {
    try {
      const [draft] = await this.db.insert(schema.transactionDrafts).values(values).returning();
      return normalizeDraft(draft);
    } catch (error) {
      if (error instanceof Error && error.message.includes('transaction_drafts_user_id_idempotency_key_unique')) {
        throw new RepositoryConflictError('draft idempotency key already exists');
      }
      throw error;
    }
  }

  async markDraftExpired(draftId: string, userId: string): Promise<DraftRecord> {
    const [draft] = await this.db.update(schema.transactionDrafts)
      .set({ status: 'EXPIRED', updatedAt: new Date() })
      .where(and(eq(schema.transactionDrafts.id, draftId), eq(schema.transactionDrafts.userId, userId), eq(schema.transactionDrafts.status, 'DRAFT')))
      .returning();
    if (!draft) throw new RepositoryConflictError('draft is no longer active');
    return normalizeDraft(draft);
  }

  async cancelDraft(draftId: string, userId: string): Promise<DraftRecord> {
    const [draft] = await this.db.update(schema.transactionDrafts)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.transactionDrafts.id, draftId), eq(schema.transactionDrafts.userId, userId), eq(schema.transactionDrafts.status, 'DRAFT')))
      .returning();
    if (!draft) throw new RepositoryConflictError('draft is no longer cancellable');
    return normalizeDraft(draft);
  }

  async listTransactions(portfolioId: string): Promise<TransactionRecord[]> {
    const transactions = await this.db.select().from(schema.transactions)
      .where(eq(schema.transactions.portfolioId, portfolioId))
      .orderBy(asc(schema.transactions.tradeAt), asc(schema.transactions.createdAt), asc(schema.transactions.id));
    return transactions.map(normalizeTransaction);
  }

  async getTransaction(transactionId: string): Promise<TransactionRecord | undefined> {
    const [transaction] = await this.db.select().from(schema.transactions).where(eq(schema.transactions.id, transactionId)).limit(1);
    return transaction ? normalizeTransaction(transaction) : undefined;
  }

  async confirmDraft(userId: string, draftId: string, confirmationKey: string, values: typeof schema.transactions.$inferInsert): Promise<TransactionRecord> {
    return this.db.transaction(async (tx) => {
      const [draft] = await tx.select().from(schema.transactionDrafts).where(and(eq(schema.transactionDrafts.id, draftId), eq(schema.transactionDrafts.userId, userId))).for('update').limit(1);
      if (!draft) throw new RepositoryNotFoundError('draft not found');
      if (draft.status === 'CONFIRMED') {
        if (draft.confirmationIdempotencyKey !== confirmationKey) throw new RepositoryConflictError('draft has already been confirmed');
        const [existing] = await tx.select().from(schema.transactions).where(eq(schema.transactions.draftId, draftId)).limit(1);
        if (!existing) throw new RepositoryConflictError('confirmed draft has no transaction');
        return normalizeTransaction(existing);
      }
      if (draft.status !== 'DRAFT') throw new RepositoryConflictError(`draft cannot be confirmed from status ${draft.status}`);
      const [transaction] = await tx.insert(schema.transactions).values(values).returning();
      await tx.update(schema.transactionDrafts).set({ status: 'CONFIRMED', confirmationIdempotencyKey: confirmationKey, updatedAt: new Date() }).where(eq(schema.transactionDrafts.id, draftId));
      return normalizeTransaction(transaction);
    });
  }

  async voidTransaction(transactionId: string): Promise<TransactionRecord> {
    const [transaction] = await this.db.update(schema.transactions).set({ status: 'VOIDED' }).where(and(eq(schema.transactions.id, transactionId), eq(schema.transactions.status, 'CONFIRMED'))).returning();
    if (!transaction) throw new RepositoryConflictError('transaction is not active');
    return normalizeTransaction(transaction);
  }

  async insertTransaction(values: typeof schema.transactions.$inferInsert): Promise<TransactionRecord> {
    const [transaction] = await this.db.insert(schema.transactions).values(values).returning();
    return normalizeTransaction(transaction);
  }
}
