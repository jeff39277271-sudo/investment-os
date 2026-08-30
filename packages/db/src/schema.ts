import { pgEnum, pgTable, text, timestamp, uuid, numeric, jsonb, unique, primaryKey, integer, boolean } from 'drizzle-orm/pg-core';

export const providerEnum = pgEnum('identity_provider', ['LINE', 'MOBILE_AUTH']);
export const transactionSideEnum = pgEnum('transaction_side', ['BUY', 'SELL']);
export const transactionSourceEnum = pgEnum('transaction_source', ['LINE', 'LIFF', 'MOBILE_APP', 'IMPORT', 'MANUAL']);
export const transactionStatusEnum = pgEnum('transaction_status', ['CONFIRMED', 'VOIDED']);
export const transactionDraftStatusEnum = pgEnum('transaction_draft_status', ['DRAFT', 'CONFIRMED', 'CANCELLED', 'EXPIRED']);
export const lineWebhookEventStatusEnum = pgEnum('line_webhook_event_status', ['PROCESSING', 'COMPLETED', 'FAILED']);
export const alertRuleTypeEnum = pgEnum('alert_rule_type', ['STOP_LOSS', 'TAKE_PROFIT']);
export const alertRuleStatusEnum = pgEnum('alert_rule_status', ['ACTIVE', 'PAUSED', 'ARCHIVED']);
export const alertConditionStateEnum = pgEnum('alert_condition_state', ['CLEAR', 'BREACHED']);
export const notificationChannelEnum = pgEnum('notification_channel', ['LINE']);
export const notificationDeliveryStatusEnum = pgEnum('notification_delivery_status', ['PENDING', 'PROCESSING', 'DELIVERED', 'FAILED']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  displayName: text('display_name'),
  timezone: text('timezone').notNull().default('Asia/Taipei'),
  baseCurrency: text('base_currency').notNull().default('TWD'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const userIdentities = pgTable('user_identities', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  provider: providerEnum('provider').notNull(),
  providerSubject: text('provider_subject').notNull(),
  metadataJson: jsonb('metadata_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ providerSubjectUnique: unique().on(table.provider, table.providerSubject) }));

export const portfolios = pgTable('portfolios', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  baseCurrency: text('base_currency').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const instruments = pgTable('instruments', {
  id: uuid('id').defaultRandom().primaryKey(),
  symbol: text('symbol').notNull(),
  name: text('name').notNull(),
  exchange: text('exchange').notNull(),
  market: text('market').notNull(),
  currency: text('currency').notNull(),
  assetType: text('asset_type').notNull(),
  providerSymbol: text('provider_symbol').notNull(),
}, (table) => ({ instrumentUnique: unique().on(table.symbol, table.exchange) }));

export const instrumentQuotes = pgTable('instrument_quotes', {
  id: uuid('id').defaultRandom().primaryKey(),
  instrumentId: uuid('instrument_id').notNull().references(() => instruments.id),
  price: numeric('price', { precision: 30, scale: 12 }).notNull(),
  currency: text('currency').notNull(),
  quoteAt: timestamp('quote_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ quoteIdentityUnique: unique().on(table.instrumentId, table.source, table.quoteAt) }));

export const transactionDrafts = pgTable('transaction_drafts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  portfolioId: uuid('portfolio_id').notNull().references(() => portfolios.id),
  instrumentId: uuid('instrument_id').notNull().references(() => instruments.id),
  side: transactionSideEnum('side').notNull(),
  quantity: numeric('quantity', { precision: 30, scale: 12 }).notNull(),
  price: numeric('price', { precision: 30, scale: 12 }).notNull(),
  tradeAt: timestamp('trade_at', { withTimezone: true }).notNull(),
  currency: text('currency').notNull(),
  fee: numeric('fee', { precision: 30, scale: 12 }).notNull().default('0'),
  tax: numeric('tax', { precision: 30, scale: 12 }).notNull().default('0'),
  source: transactionSourceEnum('source').notNull(),
  status: transactionDraftStatusEnum('status').notNull().default('DRAFT'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  confirmationIdempotencyKey: text('confirmation_idempotency_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
}, (table) => ({
  draftIdempotencyUnique: unique().on(table.userId, table.idempotencyKey),
  confirmationIdempotencyUnique: unique().on(table.userId, table.confirmationIdempotencyKey),
}));

export const transactions = pgTable('transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  draftId: uuid('draft_id').references(() => transactionDrafts.id),
  portfolioId: uuid('portfolio_id').notNull().references(() => portfolios.id),
  instrumentId: uuid('instrument_id').notNull().references(() => instruments.id),
  side: transactionSideEnum('side').notNull(),
  quantity: numeric('quantity', { precision: 30, scale: 12 }).notNull(),
  price: numeric('price', { precision: 30, scale: 12 }).notNull(),
  currency: text('currency').notNull(),
  fee: numeric('fee', { precision: 30, scale: 12 }).notNull().default('0'),
  tax: numeric('tax', { precision: 30, scale: 12 }).notNull().default('0'),
  tradeAt: timestamp('trade_at', { withTimezone: true }).notNull(),
  source: transactionSourceEnum('source').notNull(),
  status: transactionStatusEnum('status').notNull().default('CONFIRMED'),
  reversalOf: uuid('reversal_of'),
  note: text('note'),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  idempotencyUnique: unique().on(table.portfolioId, table.idempotencyKey),
  draftUnique: unique().on(table.draftId),
}));

export const alertRules = pgTable('alert_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  portfolioId: uuid('portfolio_id').notNull().references(() => portfolios.id),
  instrumentId: uuid('instrument_id').notNull().references(() => instruments.id),
  type: alertRuleTypeEnum('type').notNull(),
  triggerPrice: numeric('trigger_price', { precision: 30, scale: 12 }).notNull(),
  currency: text('currency').notNull(),
  status: alertRuleStatusEnum('status').notNull().default('ACTIVE'),
  conditionState: alertConditionStateEnum('condition_state').notNull().default('CLEAR'),
  lastEvaluatedAt: timestamp('last_evaluated_at', { withTimezone: true }),
  lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const alertTriggerEvents = pgTable('alert_trigger_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  alertRuleId: uuid('alert_rule_id').notNull().references(() => alertRules.id),
  instrumentId: uuid('instrument_id').notNull().references(() => instruments.id),
  quoteId: uuid('quote_id').notNull().references(() => instrumentQuotes.id),
  observedPrice: numeric('observed_price', { precision: 30, scale: 12 }).notNull(),
  triggerPrice: numeric('trigger_price', { precision: 30, scale: 12 }).notNull(),
  quoteAt: timestamp('quote_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ ruleQuoteUnique: unique().on(table.alertRuleId, table.quoteId) }));

export const notificationDeliveries = pgTable('notification_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  alertTriggerEventId: uuid('alert_trigger_event_id').notNull().references(() => alertTriggerEvents.id),
  channel: notificationChannelEnum('channel').notNull(),
  recipientIdentityId: uuid('recipient_identity_id').references(() => userIdentities.id),
  status: notificationDeliveryStatusEnum('status').notNull().default('PENDING'),
  attemptCount: integer('attempt_count').notNull().default(0),
  retryable: boolean('retryable').notNull().default(true),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  lastErrorCode: text('last_error_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ triggerChannelUnique: unique().on(table.alertTriggerEventId, table.channel) }));

export const positionSnapshots = pgTable('position_snapshots', {
  portfolioId: uuid('portfolio_id').notNull().references(() => portfolios.id),
  instrumentId: uuid('instrument_id').notNull().references(() => instruments.id),
  quantity: numeric('quantity', { precision: 30, scale: 12 }).notNull(),
  averageCost: numeric('average_cost', { precision: 30, scale: 12 }).notNull(),
  realizedPnl: numeric('realized_pnl', { precision: 30, scale: 12 }).notNull(),
  lastPrice: numeric('last_price', { precision: 30, scale: 12 }),
  marketValue: numeric('market_value', { precision: 30, scale: 12 }),
  unrealizedPnl: numeric('unrealized_pnl', { precision: 30, scale: 12 }),
  calculatedAt: timestamp('calculated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ snapshotPrimaryKey: primaryKey({ columns: [table.portfolioId, table.instrumentId] }) }));

export const lineWebhookEvents = pgTable('line_webhook_events', {
  eventId: text('event_id').primaryKey(),
  status: lineWebhookEventStatusEnum('status').notNull().default('PROCESSING'),
  eventType: text('event_type').notNull(),
  providerUserIdHash: text('provider_user_id_hash'),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
