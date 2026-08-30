import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AlertApplicationService, MarketDataApplicationService } from '@investment-os/application';
import { createDb, InvestmentRepository } from '@investment-os/db';
import { FakeLineMessagingClient, LineMessagingError, type LineMessagingClient } from '@investment-os/line-ui';
import { FakeMarketDataProvider, QuoteFreshnessPolicy, type MarketDataInstrument, type MarketDataProvider, type Quote } from '@investment-os/market-data';
import { Decimal } from 'decimal.js';
import { AlertMonitoringWorker } from './index.js';
import { MarketSessionPolicy } from './market-session.js';
import { ScheduledAlertRunner } from './schedule.js';

const integration = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://investment:investment@localhost:5432/investment_os' });
const repository = new InvestmentRepository(createDb(pool));
let now = new Date('2026-08-29T02:05:00.000Z');

class ControlledProvider implements MarketDataProvider {
  readonly calls: string[] = [];
  constructor(readonly prices: Map<string, string>, readonly quoteClock: () => Date = () => now, readonly failures = new Set<string>()) {}
  async getQuote(instrument: MarketDataInstrument): Promise<Quote> {
    this.calls.push(instrument.id);
    if (this.failures.has(instrument.symbol)) throw new Error('provider failed safely');
    const price = this.prices.get(instrument.symbol);
    if (!price) throw new Error('missing controlled price');
    return { instrumentId: instrument.id, symbol: instrument.symbol, price: new Decimal(price), currency: instrument.currency, quoteAt: this.quoteClock(), receivedAt: now, source: 'CONTROLLED_TEST' };
  }
  getQuotes(instruments: readonly MarketDataInstrument[]): Promise<Quote[]> { return Promise.all(instruments.map((instrument) => this.getQuote(instrument))); }
}

function services() {
  const policy = new QuoteFreshnessPolicy(5 * 60 * 1000);
  return { market: new MarketDataApplicationService(repository, policy, () => now), alerts: new AlertApplicationService(repository, policy, () => now) };
}

async function fixture(symbol = '2330', withIdentity = true, type: 'STOP_LOSS' | 'TAKE_PROFIT' = 'STOP_LOSS', triggerPrice = '1200') {
  const user = await repository.createUser({ displayName: `${symbol} User` });
  const identity = withIdentity ? await repository.createUserIdentity({ userId: user.id, provider: 'LINE', providerSubject: `LINE-${symbol}-${randomUUID()}` }) : undefined;
  const portfolio = await repository.createPortfolio({ userId: user.id, name: 'Main', baseCurrency: 'TWD' });
  const instrument = await repository.createInstrument({ symbol, name: symbol === '2330' ? '台積電' : '元大台灣50', exchange: 'TWSE', market: 'TW', currency: 'TWD', assetType: symbol === '2330' ? 'EQUITY' : 'ETF', providerSymbol: symbol });
  await repository.insertTransaction({ id: randomUUID(), portfolioId: portfolio.id, instrumentId: instrument.id, side: 'BUY', quantity: '10', price: '1250', currency: 'TWD', fee: '0', tax: '0', tradeAt: now, source: 'MANUAL', status: 'CONFIRMED', idempotencyKey: randomUUID() });
  const { alerts } = services();
  const rule = await alerts.createAlertRule({ userId: user.id, portfolioId: portfolio.id, instrumentId: instrument.id, type, triggerPrice, currency: 'TWD' });
  return { user, identity, portfolio, instrument, rule };
}

function worker(provider: MarketDataProvider, line: LineMessagingClient, options: { processingLeaseMs?: number } = {}) {
  const { market, alerts } = services();
  return new AlertMonitoringWorker(repository, market, alerts, provider, line, { clock: () => now, ...options });
}

integration('one-shot alert monitoring and LINE notification delivery', () => {
  beforeAll(async () => { await pool.query('select 1'); });
  beforeEach(async () => {
    now = new Date('2026-08-29T02:05:00.000Z');
    await pool.query('TRUNCATE TABLE notification_deliveries, alert_trigger_events, alert_rules, line_webhook_events, instrument_quotes, transactions, transaction_drafts, position_snapshots, instruments, portfolios, user_identities, users CASCADE');
  });
  afterAll(async () => pool.end());

  it('creates one durable delivery, resolves LINE identity, sends factual content, and never mutates the transaction ledger', async () => {
    const f = await fixture('2330', true, 'STOP_LOSS', '1400'); const provider = new FakeMarketDataProvider(() => now); const line = new FakeLineMessagingClient();
    const transactionsBefore = await repository.listTransactions(f.portfolio.id);
    const first = await worker(provider, line).runOnce(); const events = await repository.listAlertTriggerEvents(f.rule.id);
    expect(first).toEqual({ rulesEvaluated: 1, quotesRefreshed: 1, quoteFailures: 0, alertsTriggered: 1, notificationsDelivered: 1, notificationsFailed: 0 });
    expect(events).toHaveLength(1); expect(line.pushes).toHaveLength(1); expect(line.pushes[0]?.lineUserId).toBe(f.identity?.providerSubject);
    const text = JSON.stringify(line.pushes[0]?.messages); expect(text).toContain('停損警示條件已觸發'); expect(text).toContain('2330 台積電'); expect(text).toContain('1,300 TWD'); expect(text).toContain('1,400 TWD'); expect(text).toContain('FAKE_DEVELOPMENT');
    expect(await repository.getNotificationDelivery(events[0]!.id)).toMatchObject({ status: 'DELIVERED', attemptCount: 1, recipientIdentityId: f.identity?.id, retryable: false });
    expect((await repository.getNotificationDelivery(events[0]!.id))?.deliveredAt).toEqual(now);
    expect(await repository.listTransactions(f.portfolio.id)).toEqual(transactionsBefore);
    expect(Number((await pool.query('select count(*) from transaction_drafts')).rows[0].count)).toBe(0);

    await worker(provider, line).runOnce();
    expect(line.pushes).toHaveLength(1); expect(await repository.listAlertTriggerEvents(f.rule.id)).toHaveLength(1);
    expect(Number((await pool.query('select count(*) from notification_deliveries')).rows[0].count)).toBe(1);
  });

  it('handles missing identity and stale quotes without unsafe notification', async () => {
    const noIdentity = await fixture('2330', false); const noRecipientLine = new FakeLineMessagingClient();
    await worker(new ControlledProvider(new Map([['2330', '1190']])), noRecipientLine).runOnce();
    const event = (await repository.listAlertTriggerEvents(noIdentity.rule.id))[0]!;
    expect(await repository.getNotificationDelivery(event.id)).toMatchObject({ status: 'FAILED', retryable: false, lastErrorCode: 'NO_RECIPIENT', recipientIdentityId: null });
    expect(noRecipientLine.pushes).toHaveLength(0);

    await pool.query('TRUNCATE TABLE notification_deliveries, alert_trigger_events, alert_rules, instrument_quotes, transactions, instruments, portfolios, user_identities, users CASCADE');
    const stale = await fixture(); const staleLine = new FakeLineMessagingClient();
    const staleAt = new Date(now.getTime() - 5 * 60 * 1000 - 1);
    await worker(new ControlledProvider(new Map([['2330', '1190']]), () => staleAt), staleLine).runOnce();
    expect(await repository.listAlertTriggerEvents(stale.rule.id)).toHaveLength(0);
    expect(Number((await pool.query('select count(*) from notification_deliveries')).rows[0].count)).toBe(0);
    expect(staleLine.pushes).toHaveLength(0);
  });

  it('prevents duplicate push across concurrent workers and uses one refresh per instrument per run', async () => {
    const f = await fixture(); const { alerts } = services();
    await alerts.createAlertRule({ userId: f.user.id, portfolioId: f.portfolio.id, instrumentId: f.instrument.id, type: 'TAKE_PROFIT', triggerPrice: '1100', currency: 'TWD' });
    const provider = new ControlledProvider(new Map([['2330', '1190']])); const line = new FakeLineMessagingClient();
    await Promise.all([worker(provider, line).runOnce(), worker(provider, line).runOnce()]);
    expect(provider.calls).toHaveLength(2); // once per independent worker run, not once per rule
    expect(line.pushes).toHaveLength(2); // one unique trigger for each of the two distinct rules
    expect(new Set(line.pushes.map(({ retryKey }) => retryKey)).size).toBe(2);
    expect(Number((await pool.query('select count(*) from notification_deliveries')).rows[0].count)).toBe(2);
  });

  it('re-arms after recovery and creates exactly one new delivery for a second crossing', async () => {
    const f = await fixture(); const prices = new Map([['2330', '1190']]); const provider = new ControlledProvider(prices); const line = new FakeLineMessagingClient();
    await worker(provider, line).runOnce();
    now = new Date(now.getTime() + 60_000); prices.set('2330', '1210'); await worker(provider, line).runOnce();
    now = new Date(now.getTime() + 60_000); prices.set('2330', '1180'); await worker(provider, line).runOnce();
    expect(await repository.listAlertTriggerEvents(f.rule.id)).toHaveLength(2); expect(line.pushes).toHaveLength(2);
    expect(Number((await pool.query('select count(*) from notification_deliveries')).rows[0].count)).toBe(2);
  });

  it('continues delivering other notifications when one LINE recipient fails', async () => {
    const first = await fixture('2330'); const second = await fixture('0050');
    const successfulRecipients: string[] = [];
    const partiallyFailingLine: LineMessagingClient = {
      reply: async () => {},
      push: async (recipient) => {
        if (recipient === first.identity?.providerSubject) throw new LineMessagingError('PROVIDER_UNAVAILABLE', true, 'LINE unavailable');
        successfulRecipients.push(recipient);
      },
    };
    const result = await worker(new ControlledProvider(new Map([['2330', '1190'], ['0050', '50']])), partiallyFailingLine).runOnce();
    expect(result).toMatchObject({ alertsTriggered: 2, notificationsDelivered: 1, notificationsFailed: 1 });
    expect(successfulRecipients).toEqual([second.identity?.providerSubject]);
    const firstEvent = (await repository.listAlertTriggerEvents(first.rule.id))[0]!;
    const secondEvent = (await repository.listAlertTriggerEvents(second.rule.id))[0]!;
    expect(await repository.getNotificationDelivery(firstEvent.id)).toMatchObject({ status: 'FAILED', retryable: true, lastErrorCode: 'PROVIDER_UNAVAILABLE' });
    expect(await repository.getNotificationDelivery(secondEvent.id)).toMatchObject({ status: 'DELIVERED' });
  });

  it('isolates quote and LINE failures, retries retryable delivery, and reclaims an expired PROCESSING lease', async () => {
    const first = await fixture('2330'); await fixture('0050');
    const provider = new ControlledProvider(new Map([['2330', '1190'], ['0050', '50']]), () => now, new Set(['0050']));
    const failingLine: LineMessagingClient = { reply: async () => {}, push: async () => { throw new LineMessagingError('RATE_LIMITED', true, 'rate limited'); } };
    const result = await worker(provider, failingLine).runOnce(); const event = (await repository.listAlertTriggerEvents(first.rule.id))[0]!;
    expect(result).toMatchObject({ quotesRefreshed: 1, quoteFailures: 1, alertsTriggered: 1, notificationsFailed: 1 });
    expect(await repository.getNotificationDelivery(event.id)).toMatchObject({ status: 'FAILED', retryable: true, attemptCount: 1, lastErrorCode: 'RATE_LIMITED' });

    const retryLine = new FakeLineMessagingClient(); now = new Date(now.getTime() + 60_000);
    await worker(provider, retryLine).runOnce();
    expect(retryLine.pushes).toHaveLength(1); expect(await repository.getNotificationDelivery(event.id)).toMatchObject({ status: 'DELIVERED', attemptCount: 2 });

    await pool.query("update notification_deliveries set status='PROCESSING', retryable=true, delivered_at=null, locked_at=$1 where alert_trigger_event_id=$2", [new Date(now.getTime() - 10 * 60_000), event.id]);
    const reclaimedLine = new FakeLineMessagingClient(); now = new Date(now.getTime() + 60_000);
    await worker(provider, reclaimedLine, { processingLeaseMs: 5 * 60_000 }).runOnce();
    expect(reclaimedLine.pushes).toHaveLength(1);
    expect(reclaimedLine.pushes[0]?.retryKey).toBe((await repository.getNotificationDelivery(event.id))?.id);
    expect(await repository.getNotificationDelivery(event.id)).toMatchObject({ status: 'DELIVERED', attemptCount: 3 });
  });

  it('runs deterministic scheduled Fake provider to Fake LINE E2E only during TWSE session', async () => {
    now = new Date('2026-08-31T01:00:00.000Z'); // Monday 09:00 Asia/Taipei
    const f = await fixture('2330', true, 'STOP_LOSS', '1400'); const fakeProvider = new FakeMarketDataProvider(() => now); let quoteCalls = 0;
    const provider: MarketDataProvider = {
      getQuote: async (instrument) => { quoteCalls += 1; return fakeProvider.getQuote(instrument); },
      getQuotes: async (instruments) => Promise.all(instruments.map(async (instrument) => { quoteCalls += 1; return fakeProvider.getQuote(instrument); })),
    };
    const line = new FakeLineMessagingClient();
    const scheduledWorker = worker(provider, line); const logs: unknown[] = [];
    const scheduler = new ScheduledAlertRunner(repository, scheduledWorker, new MarketSessionPolicy(), { intervalMs: 60_000, leaseMs: 120_000, ownerId: 'scheduled-e2e', clock: () => now, logger: { log: (event) => logs.push(event) } });
    expect(await scheduler.tick()).toMatchObject({ result: 'COMPLETED', summary: { alertsTriggered: 1, notificationsDelivered: 1 } });
    expect(await repository.listAlertTriggerEvents(f.rule.id)).toHaveLength(1); expect(line.pushes).toHaveLength(1); expect(quoteCalls).toBe(1);

    now = new Date('2026-08-31T00:59:59.000Z'); // 08:59:59 Asia/Taipei
    expect(await scheduler.tick()).toMatchObject({ result: 'SKIPPED_MARKET_CLOSED' });
    expect(await repository.listAlertTriggerEvents(f.rule.id)).toHaveLength(1); expect(line.pushes).toHaveLength(1); expect(quoteCalls).toBe(1);
    expect(logs).toHaveLength(2);
  });
});
