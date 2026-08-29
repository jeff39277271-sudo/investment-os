import { randomUUID } from 'node:crypto';
import {
  calculatePositions,
  DomainValidationError,
  summarizePortfolio,
  validateTransaction,
  type Transaction,
  type PortfolioSummary,
} from '@investment-os/domain';
import {
  InvestmentRepository,
  RepositoryNotFoundError,
  type AlertRuleRecord,
  type AlertTriggerEventRecord,
  type DraftRecord,
  type TransactionRecord,
} from '@investment-os/db';
import type { ClientSource } from '@investment-os/shared';
import { Decimal } from 'decimal.js';
import { QuoteFreshnessPolicy, type MarketDataProvider, type Quote, type QuoteFreshness } from '@investment-os/market-data';
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
    const lastCreatedAt = transactions.reduce((latest, transaction) => Math.max(latest, transaction.createdAt.getTime()), 0);
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
      createdAt: new Date(lastCreatedAt + 1),
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
      createdAt: undefined,
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
      createdAt: undefined,
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
      createdAt: transaction.createdAt,
      idempotencyKey: transaction.idempotencyKey,
    };
  }
}

export class LineApplicationService {
  constructor(private readonly repository: InvestmentRepository) {}

  getOrCreateIdentity(providerUserId: string) {
    if (!providerUserId.trim()) throw new ApplicationAuthorizationError('LINE user identity is missing');
    return this.repository.getOrCreateLineUser(providerUserId);
  }

  findInstrument(symbol: string) {
    return this.repository.findInstrumentBySymbol(symbol);
  }

  findLatestActiveDraft(userId: string) {
    return this.repository.findLatestActiveDraft(userId);
  }

  claimWebhookEvent(eventId: string, eventType: string, providerUserIdHash?: string) {
    if (!eventId.trim()) throw new ApplicationConflictError('LINE webhookEventId is required');
    return this.repository.claimLineWebhookEvent(eventId, eventType, providerUserIdHash);
  }

  completeWebhookEvent(eventId: string) {
    return this.repository.completeLineWebhookEvent(eventId);
  }

  failWebhookEvent(eventId: string, error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown LINE webhook failure';
    return this.repository.failLineWebhookEvent(eventId, message);
  }
}

export type PortfolioValuation = PortfolioSummary & { quotes: QuoteFreshness[]; valuedAt: Date };

export class MarketDataApplicationService {
  constructor(
    private readonly repository: InvestmentRepository,
    private readonly freshnessPolicy: QuoteFreshnessPolicy,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async refreshQuote(instrumentId: string, provider: MarketDataProvider) {
    const instrument = await this.repository.getInstrument(instrumentId);
    if (!instrument) throw new ApplicationConflictError('instrument does not exist');
    return this.ingestQuote(await provider.getQuote({
      id: instrument.id, symbol: instrument.symbol, currency: instrument.currency,
      market: instrument.market, exchange: instrument.exchange, providerSymbol: instrument.providerSymbol,
    }));
  }

  async ingestQuote(quote: Quote) {
    const instrument = await this.repository.getInstrument(quote.instrumentId);
    if (!instrument || instrument.symbol !== quote.symbol) throw new ApplicationConflictError('quote instrument identity does not match instrument master');
    if (instrument.currency !== quote.currency) throw new DomainValidationError('quote currency must match instrument currency');
    if (!quote.source.trim()) throw new DomainValidationError('quote source is required');
    if (Number.isNaN(quote.quoteAt.getTime()) || Number.isNaN(quote.receivedAt.getTime())) throw new DomainValidationError('quote timestamps must be valid');
    if (!quote.price.isFinite() || quote.price.lte(0)) throw new DomainValidationError('quote price must be greater than zero');
    return this.repository.persistQuote({
      instrumentId: quote.instrumentId, price: quote.price.toString(), currency: quote.currency,
      quoteAt: quote.quoteAt, receivedAt: quote.receivedAt, source: quote.source,
    });
  }

  async getPortfolioValuation(userId: string, portfolioId: string): Promise<PortfolioValuation> {
    const portfolio = await this.repository.getPortfolio(portfolioId);
    if (!portfolio || portfolio.userId !== userId) throw new ApplicationAuthorizationError('portfolio does not belong to user');
    const transactions = await this.repository.listTransactions(portfolioId);
    const instrumentIds = [...new Set(transactions.map((transaction) => transaction.instrumentId))];
    const [quoteRecords, instruments] = await Promise.all([
      this.repository.getLatestQuotes(instrumentIds),
      Promise.all(instrumentIds.map((instrumentId) => this.repository.getInstrument(instrumentId))),
    ]);
    const prices = new Map<string, Decimal>();
    const valuedAt = this.clock();
    const quotes = instrumentIds.map((instrumentId, index) => {
      const quote = quoteRecords.get(instrumentId);
      const instrument = instruments[index];
      if (!instrument) throw new ApplicationConflictError('transaction instrument does not exist');
      if (quote) {
        if (quote.currency !== instrument.currency || quote.currency !== portfolio.baseCurrency) throw new DomainValidationError('quote currency cannot be mixed with portfolio currency');
        prices.set(instrumentId, new Decimal(quote.price));
      }
      return this.freshnessPolicy.classify(instrumentId, quote ? { quoteAt: quote.quoteAt, receivedAt: quote.receivedAt, source: quote.source } : undefined, valuedAt);
    });
    return { ...summarizePortfolio(portfolioId, portfolio.baseCurrency, transactions.map((transaction) => this.toDomainTransaction(transaction)), prices), quotes, valuedAt };
  }

  private toDomainTransaction(transaction: TransactionRecord): Transaction {
    return {
      id: transaction.id, portfolioId: transaction.portfolioId, instrumentId: transaction.instrumentId,
      side: transaction.side, quantity: transaction.quantity, price: transaction.price, currency: transaction.currency,
      fee: transaction.fee, tax: transaction.tax, tradeAt: transaction.tradeAt, source: transaction.source,
      status: transaction.status, reversalOf: transaction.reversalOf, note: transaction.note,
      createdAt: transaction.createdAt, idempotencyKey: transaction.idempotencyKey,
    };
  }
}

export type AlertEvaluationResult =
  | 'TRIGGERED' | 'CLEAR' | 'ALREADY_BREACHED'
  | 'SKIPPED_STALE' | 'SKIPPED_MISSING' | 'SKIPPED_NO_POSITION'
  | 'SKIPPED_PAUSED' | 'SKIPPED_ARCHIVED';

export type CreateAlertRuleInput = {
  userId: string; portfolioId: string; instrumentId: string;
  type: 'STOP_LOSS' | 'TAKE_PROFIT'; triggerPrice: string; currency: string;
};

export class AlertApplicationService {
  constructor(
    private readonly repository: InvestmentRepository,
    private readonly freshnessPolicy: QuoteFreshnessPolicy,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async createAlertRule(input: CreateAlertRuleInput): Promise<AlertRuleRecord> {
    const triggerPrice = this.positivePrice(input.triggerPrice);
    const [portfolio, instrument] = await Promise.all([
      this.repository.getPortfolio(input.portfolioId), this.repository.getInstrument(input.instrumentId),
    ]);
    if (!portfolio || portfolio.userId !== input.userId) throw new ApplicationAuthorizationError('portfolio does not belong to user');
    if (!instrument) throw new ApplicationConflictError('instrument does not exist');
    if (input.currency !== instrument.currency || input.currency !== portfolio.baseCurrency) throw new DomainValidationError('alert currency must match instrument and portfolio currency');
    await this.assertPositivePosition(input.portfolioId, input.instrumentId);
    const now = this.clock();
    return this.repository.createAlertRule({ ...input, triggerPrice: triggerPrice.toString(), status: 'ACTIVE', conditionState: 'CLEAR', createdAt: now, updatedAt: now });
  }

  async getAlertRule(ruleId: string, userId: string): Promise<AlertRuleRecord> { return this.requireOwnedRule(ruleId, userId); }

  async listPortfolioAlertRules(portfolioId: string, userId: string): Promise<AlertRuleRecord[]> {
    const portfolio = await this.repository.getPortfolio(portfolioId);
    if (!portfolio || portfolio.userId !== userId) throw new ApplicationAuthorizationError('portfolio does not belong to user');
    return this.repository.listPortfolioAlertRules(portfolioId, userId);
  }

  async updateAlertTriggerPrice(ruleId: string, userId: string, triggerPrice: string): Promise<AlertRuleRecord> {
    const rule = await this.requireOwnedRule(ruleId, userId);
    if (rule.status === 'ARCHIVED') throw new ApplicationConflictError('archived alert rule cannot be updated');
    return this.repository.updateAlertRule(ruleId, userId, { triggerPrice: this.positivePrice(triggerPrice).toString(), conditionState: 'CLEAR', updatedAt: this.clock() });
  }

  async pauseAlertRule(ruleId: string, userId: string): Promise<AlertRuleRecord> {
    const rule = await this.requireOwnedRule(ruleId, userId);
    if (rule.status === 'ARCHIVED') throw new ApplicationConflictError('archived alert rule cannot be paused');
    if (rule.status === 'PAUSED') return rule;
    return this.repository.updateAlertRule(ruleId, userId, { status: 'PAUSED', updatedAt: this.clock() });
  }

  async resumeAlertRule(ruleId: string, userId: string): Promise<AlertRuleRecord> {
    const rule = await this.requireOwnedRule(ruleId, userId);
    if (rule.status !== 'PAUSED') throw new ApplicationConflictError('only paused alert rules can be resumed');
    return this.repository.updateAlertRule(ruleId, userId, { status: 'ACTIVE', conditionState: 'CLEAR', updatedAt: this.clock() });
  }

  async archiveAlertRule(ruleId: string, userId: string): Promise<AlertRuleRecord> {
    const rule = await this.requireOwnedRule(ruleId, userId);
    if (rule.status === 'ARCHIVED') return rule;
    return this.repository.updateAlertRule(ruleId, userId, { status: 'ARCHIVED', updatedAt: this.clock() });
  }

  async evaluateAlertRule(ruleId: string, userId: string): Promise<{ result: AlertEvaluationResult; rule: AlertRuleRecord; event?: AlertTriggerEventRecord }> {
    await this.requireOwnedRule(ruleId, userId);
    const evaluatedAt = this.clock();
    try {
      const outcome = await this.repository.evaluateAlertRuleAtomic(ruleId, userId, evaluatedAt, ({ rule, quote, transactions }) => {
        if (rule.status === 'PAUSED') return { result: 'SKIPPED_PAUSED', evaluated: false, nextConditionState: rule.conditionState, trigger: false };
        if (rule.status === 'ARCHIVED') return { result: 'SKIPPED_ARCHIVED', evaluated: false, nextConditionState: rule.conditionState, trigger: false };
        const position = calculatePositions(transactions.map((transaction) => this.toDomainTransaction(transaction)), rule.portfolioId).get(rule.instrumentId);
        if (!position || position.quantity.lte(0)) return { result: 'SKIPPED_NO_POSITION', evaluated: true, nextConditionState: rule.conditionState, trigger: false };
        if (!quote) return { result: 'SKIPPED_MISSING', evaluated: true, nextConditionState: rule.conditionState, trigger: false };
        if (quote.currency !== rule.currency) throw new DomainValidationError('alert rule and quote currencies do not match');
        const freshness = this.freshnessPolicy.classify(rule.instrumentId, { quoteAt: quote.quoteAt, receivedAt: quote.receivedAt, source: quote.source }, evaluatedAt);
        if (freshness.status === 'STALE') return { result: 'SKIPPED_STALE', evaluated: true, nextConditionState: rule.conditionState, trigger: false };
        const observed = new Decimal(quote.price); const threshold = new Decimal(rule.triggerPrice);
        const breached = rule.type === 'STOP_LOSS' ? observed.lte(threshold) : observed.gte(threshold);
        if (!breached) return { result: 'CLEAR', evaluated: true, nextConditionState: 'CLEAR', trigger: false };
        if (rule.conditionState === 'BREACHED') return { result: 'ALREADY_BREACHED', evaluated: true, nextConditionState: 'BREACHED', trigger: false };
        return { result: 'TRIGGERED', evaluated: true, nextConditionState: 'BREACHED', trigger: true };
      });
      return outcome as { result: AlertEvaluationResult; rule: AlertRuleRecord; event?: AlertTriggerEventRecord };
    } catch (error) {
      if (error instanceof RepositoryNotFoundError) throw new ApplicationAuthorizationError('alert rule does not belong to user or does not exist');
      throw error;
    }
  }

  async evaluatePortfolioAlerts(portfolioId: string, userId: string) {
    const rules = await this.listPortfolioAlertRules(portfolioId, userId);
    return Promise.all(rules.map((rule) => this.evaluateAlertRule(rule.id, userId)));
  }

  private positivePrice(value: string): Decimal {
    try {
      const price = new Decimal(value);
      if (!price.isFinite() || price.lte(0)) throw new Error('not positive');
      return price;
    } catch { throw new DomainValidationError('trigger price must be greater than zero'); }
  }

  private async assertPositivePosition(portfolioId: string, instrumentId: string): Promise<void> {
    const transactions = await this.repository.listTransactions(portfolioId);
    const position = calculatePositions(transactions.map((transaction) => this.toDomainTransaction(transaction)), portfolioId).get(instrumentId);
    if (!position || position.quantity.lte(0)) throw new ApplicationConflictError('alert rule requires a positive portfolio position');
  }

  private async requireOwnedRule(ruleId: string, userId: string): Promise<AlertRuleRecord> {
    const rule = await this.repository.getAlertRule(ruleId, userId);
    if (!rule) throw new ApplicationAuthorizationError('alert rule does not belong to user or does not exist');
    return rule;
  }

  private toDomainTransaction(transaction: TransactionRecord): Transaction {
    return {
      id: transaction.id, portfolioId: transaction.portfolioId, instrumentId: transaction.instrumentId,
      side: transaction.side, quantity: transaction.quantity, price: transaction.price, currency: transaction.currency,
      fee: transaction.fee, tax: transaction.tax, tradeAt: transaction.tradeAt, source: transaction.source,
      status: transaction.status, reversalOf: transaction.reversalOf, note: transaction.note,
      createdAt: transaction.createdAt, idempotencyKey: transaction.idempotencyKey,
    };
  }
}

export { summarizePortfolio };
