import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
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
export type LineWebhookEventRecord = typeof schema.lineWebhookEvents.$inferSelect;
export type QuoteRecord = typeof schema.instrumentQuotes.$inferSelect;
export type AlertRuleRecord = typeof schema.alertRules.$inferSelect;
export type AlertTriggerEventRecord = typeof schema.alertTriggerEvents.$inferSelect;
export type AlertEvaluationDecision = { result: string; evaluated: boolean; nextConditionState: 'CLEAR' | 'BREACHED'; trigger: boolean };
export type AlertEvaluationContext = { rule: AlertRuleRecord; quote?: QuoteRecord; transactions: TransactionRecord[] };

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

function normalizeQuote(record: QuoteRecord): QuoteRecord {
  return { ...record, price: canonicalDecimal(record.price) };
}

function normalizeAlertRule(record: AlertRuleRecord): AlertRuleRecord {
  return { ...record, triggerPrice: canonicalDecimal(record.triggerPrice) };
}

function normalizeAlertTriggerEvent(record: AlertTriggerEventRecord): AlertTriggerEventRecord {
  return { ...record, observedPrice: canonicalDecimal(record.observedPrice), triggerPrice: canonicalDecimal(record.triggerPrice) };
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

  async findUserIdentity(provider: 'LINE' | 'MOBILE_AUTH', providerSubject: string): Promise<UserIdentityRecord | undefined> {
    const [identity] = await this.db.select().from(schema.userIdentities)
      .where(and(eq(schema.userIdentities.provider, provider), eq(schema.userIdentities.providerSubject, providerSubject))).limit(1);
    return identity;
  }

  async getOrCreateLineUser(providerSubject: string): Promise<{ user: UserRecord; identity: UserIdentityRecord; portfolio: PortfolioRecord }> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('LINE:' || ${providerSubject}))`);
      const [existingIdentity] = await tx.select().from(schema.userIdentities)
        .where(and(eq(schema.userIdentities.provider, 'LINE'), eq(schema.userIdentities.providerSubject, providerSubject))).limit(1);
      if (existingIdentity) {
        const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, existingIdentity.userId)).limit(1);
        const [portfolio] = await tx.select().from(schema.portfolios).where(eq(schema.portfolios.userId, existingIdentity.userId)).orderBy(asc(schema.portfolios.createdAt)).limit(1);
        if (!user || !portfolio) throw new RepositoryConflictError('LINE identity is missing its user or portfolio');
        return { user, identity: existingIdentity, portfolio };
      }
      const [user] = await tx.insert(schema.users).values({}).returning();
      const [identity] = await tx.insert(schema.userIdentities).values({ userId: user.id, provider: 'LINE', providerSubject }).returning();
      const [portfolio] = await tx.insert(schema.portfolios).values({ userId: user.id, name: '主要投資組合', baseCurrency: user.baseCurrency }).returning();
      return { user, identity, portfolio };
    });
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

  async findInstrumentBySymbol(symbol: string): Promise<InstrumentRecord | undefined> {
    const matches = await this.db.select().from(schema.instruments).where(eq(schema.instruments.symbol, symbol)).limit(2);
    return matches.length === 1 ? matches[0] : undefined;
  }

  async persistQuote(values: typeof schema.instrumentQuotes.$inferInsert): Promise<QuoteRecord> {
    const [quote] = await this.db.insert(schema.instrumentQuotes).values(values).onConflictDoUpdate({
      target: [schema.instrumentQuotes.instrumentId, schema.instrumentQuotes.source, schema.instrumentQuotes.quoteAt],
      set: { price: values.price, currency: values.currency, receivedAt: values.receivedAt },
    }).returning();
    return normalizeQuote(quote);
  }

  async getLatestQuote(instrumentId: string): Promise<QuoteRecord | undefined> {
    const [quote] = await this.db.select().from(schema.instrumentQuotes)
      .where(eq(schema.instrumentQuotes.instrumentId, instrumentId))
      .orderBy(desc(schema.instrumentQuotes.quoteAt), desc(schema.instrumentQuotes.receivedAt), desc(schema.instrumentQuotes.id)).limit(1);
    return quote ? normalizeQuote(quote) : undefined;
  }

  async getLatestQuotes(instrumentIds: readonly string[]): Promise<Map<string, QuoteRecord>> {
    if (instrumentIds.length === 0) return new Map();
    const quotes = await this.db.select().from(schema.instrumentQuotes)
      .where(inArray(schema.instrumentQuotes.instrumentId, [...instrumentIds]))
      .orderBy(asc(schema.instrumentQuotes.instrumentId), desc(schema.instrumentQuotes.quoteAt), desc(schema.instrumentQuotes.receivedAt), desc(schema.instrumentQuotes.id));
    const latest = new Map<string, QuoteRecord>();
    for (const quote of quotes) if (!latest.has(quote.instrumentId)) latest.set(quote.instrumentId, normalizeQuote(quote));
    return latest;
  }

  async createAlertRule(values: typeof schema.alertRules.$inferInsert): Promise<AlertRuleRecord> {
    const [rule] = await this.db.insert(schema.alertRules).values(values).returning();
    return normalizeAlertRule(rule);
  }

  async getAlertRule(ruleId: string, userId: string): Promise<AlertRuleRecord | undefined> {
    const [rule] = await this.db.select().from(schema.alertRules)
      .where(and(eq(schema.alertRules.id, ruleId), eq(schema.alertRules.userId, userId))).limit(1);
    return rule ? normalizeAlertRule(rule) : undefined;
  }

  async listPortfolioAlertRules(portfolioId: string, userId: string): Promise<AlertRuleRecord[]> {
    const rules = await this.db.select().from(schema.alertRules)
      .where(and(eq(schema.alertRules.portfolioId, portfolioId), eq(schema.alertRules.userId, userId)))
      .orderBy(asc(schema.alertRules.createdAt), asc(schema.alertRules.id));
    return rules.map(normalizeAlertRule);
  }

  async updateAlertRule(ruleId: string, userId: string, values: Partial<Pick<typeof schema.alertRules.$inferInsert, 'triggerPrice' | 'status' | 'conditionState' | 'lastEvaluatedAt' | 'lastTriggeredAt' | 'updatedAt'>>): Promise<AlertRuleRecord> {
    const [rule] = await this.db.update(schema.alertRules).set(values)
      .where(and(eq(schema.alertRules.id, ruleId), eq(schema.alertRules.userId, userId))).returning();
    if (!rule) throw new RepositoryNotFoundError('alert rule not found');
    return normalizeAlertRule(rule);
  }

  async listAlertTriggerEvents(ruleId: string): Promise<AlertTriggerEventRecord[]> {
    const events = await this.db.select().from(schema.alertTriggerEvents)
      .where(eq(schema.alertTriggerEvents.alertRuleId, ruleId)).orderBy(asc(schema.alertTriggerEvents.createdAt), asc(schema.alertTriggerEvents.id));
    return events.map(normalizeAlertTriggerEvent);
  }

  async evaluateAlertRuleAtomic(
    ruleId: string,
    userId: string,
    evaluatedAt: Date,
    evaluator: (context: AlertEvaluationContext) => AlertEvaluationDecision,
  ): Promise<{ rule: AlertRuleRecord; event?: AlertTriggerEventRecord; result: string }> {
    return this.db.transaction(async (tx) => {
      const [rawRule] = await tx.select().from(schema.alertRules)
        .where(and(eq(schema.alertRules.id, ruleId), eq(schema.alertRules.userId, userId))).for('update').limit(1);
      if (!rawRule) throw new RepositoryNotFoundError('alert rule not found');
      const rule = normalizeAlertRule(rawRule);
      const [rawQuote] = await tx.select().from(schema.instrumentQuotes)
        .where(eq(schema.instrumentQuotes.instrumentId, rule.instrumentId))
        .orderBy(desc(schema.instrumentQuotes.quoteAt), desc(schema.instrumentQuotes.receivedAt), desc(schema.instrumentQuotes.id)).limit(1);
      const rawTransactions = await tx.select().from(schema.transactions)
        .where(eq(schema.transactions.portfolioId, rule.portfolioId))
        .orderBy(asc(schema.transactions.tradeAt), asc(schema.transactions.createdAt), asc(schema.transactions.id));
      const quote = rawQuote ? normalizeQuote(rawQuote) : undefined;
      const decision = evaluator({ rule, quote, transactions: rawTransactions.map(normalizeTransaction) });
      if (!decision.evaluated) return { rule, result: decision.result };

      let event: AlertTriggerEventRecord | undefined;
      let result = decision.result;
      if (decision.trigger) {
        if (!quote) throw new RepositoryConflictError('trigger decision requires a quote');
        const inserted = await tx.insert(schema.alertTriggerEvents).values({
          alertRuleId: rule.id, instrumentId: rule.instrumentId, quoteId: quote.id,
          observedPrice: quote.price, triggerPrice: rule.triggerPrice, quoteAt: quote.quoteAt, createdAt: evaluatedAt,
        }).onConflictDoNothing().returning();
        if (inserted[0]) event = normalizeAlertTriggerEvent(inserted[0]);
        else result = 'ALREADY_BREACHED';
      }
      const [updated] = await tx.update(schema.alertRules).set({
        conditionState: decision.nextConditionState,
        lastEvaluatedAt: evaluatedAt,
        lastTriggeredAt: event ? evaluatedAt : rule.lastTriggeredAt,
        updatedAt: evaluatedAt,
      }).where(eq(schema.alertRules.id, rule.id)).returning();
      return { rule: normalizeAlertRule(updated), event, result };
    });
  }

  async findLatestActiveDraft(userId: string): Promise<DraftRecord | undefined> {
    const [draft] = await this.db.select().from(schema.transactionDrafts)
      .where(and(eq(schema.transactionDrafts.userId, userId), eq(schema.transactionDrafts.status, 'DRAFT')))
      .orderBy(desc(schema.transactionDrafts.createdAt)).limit(1);
    return draft ? normalizeDraft(draft) : undefined;
  }

  async claimLineWebhookEvent(eventId: string, eventType: string, providerUserIdHash?: string): Promise<boolean> {
    const inserted = await this.db.insert(schema.lineWebhookEvents).values({ eventId, eventType, providerUserIdHash })
      .onConflictDoNothing().returning();
    if (inserted.length > 0) return true;
    const retried = await this.db.update(schema.lineWebhookEvents)
      .set({ status: 'PROCESSING', lastError: null, updatedAt: new Date() })
      .where(and(
        eq(schema.lineWebhookEvents.eventId, eventId),
        or(
          eq(schema.lineWebhookEvents.status, 'FAILED'),
          and(eq(schema.lineWebhookEvents.status, 'PROCESSING'), lt(schema.lineWebhookEvents.updatedAt, new Date(Date.now() - 5 * 60 * 1000))),
        ),
      )).returning();
    return retried.length > 0;
  }

  async completeLineWebhookEvent(eventId: string): Promise<void> {
    await this.db.update(schema.lineWebhookEvents).set({ status: 'COMPLETED', completedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.lineWebhookEvents.eventId, eventId));
  }

  async failLineWebhookEvent(eventId: string, error: string): Promise<void> {
    await this.db.update(schema.lineWebhookEvents).set({ status: 'FAILED', lastError: error.slice(0, 1000), updatedAt: new Date() })
      .where(eq(schema.lineWebhookEvents.eventId, eventId));
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
