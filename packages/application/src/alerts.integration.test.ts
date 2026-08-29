import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, InvestmentRepository } from '@investment-os/db';
import { calculatePositions, DomainValidationError } from '@investment-os/domain';
import { QuoteFreshnessPolicy } from '@investment-os/market-data';
import { AlertApplicationService, ApplicationAuthorizationError, ApplicationConflictError } from './index.js';

const integration = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://investment:investment@localhost:5432/investment_os' });
const repository = new InvestmentRepository(createDb(pool));
let now = new Date('2026-08-29T03:00:00.000Z');
const alerts = new AlertApplicationService(repository, new QuoteFreshnessPolicy(5 * 60 * 1000), () => now);

async function fixture() {
  const user = await repository.createUser({ displayName: 'Alert User' });
  const otherUser = await repository.createUser({ displayName: 'Other Alert User' });
  const portfolio = await repository.createPortfolio({ userId: user.id, name: 'Main', baseCurrency: 'TWD' });
  const otherPortfolio = await repository.createPortfolio({ userId: otherUser.id, name: 'Other', baseCurrency: 'TWD' });
  const instrument = await repository.createInstrument({ symbol: '2330', name: '台積電', exchange: 'TWSE', market: 'TW', currency: 'TWD', assetType: 'EQUITY', providerSymbol: '2330' });
  return { user, otherUser, portfolio, otherPortfolio, instrument };
}

async function transaction(f: Awaited<ReturnType<typeof fixture>>, side: 'BUY' | 'SELL', quantity = '100', price = '1250') {
  return repository.insertTransaction({ id: randomUUID(), portfolioId: f.portfolio.id, instrumentId: f.instrument.id, side, quantity, price, currency: 'TWD', fee: '0', tax: '0', tradeAt: now, source: 'MANUAL', status: 'CONFIRMED', idempotencyKey: randomUUID() });
}

async function createRule(f: Awaited<ReturnType<typeof fixture>>, type: 'STOP_LOSS' | 'TAKE_PROFIT' = 'STOP_LOSS', triggerPrice = '1200') {
  return alerts.createAlertRule({ userId: f.user.id, portfolioId: f.portfolio.id, instrumentId: f.instrument.id, type, triggerPrice, currency: 'TWD' });
}

async function quote(f: Awaited<ReturnType<typeof fixture>>, price: string, quoteAt = new Date(now.getTime() - 60_000), currency = 'TWD') {
  return repository.persistQuote({ instrumentId: f.instrument.id, price, currency, quoteAt, receivedAt: now, source: `TEST_${quoteAt.toISOString()}_${price}` });
}

integration('alert rules engine', () => {
  beforeAll(async () => { await pool.query('select 1'); });
  beforeEach(async () => {
    now = new Date('2026-08-29T03:00:00.000Z');
    await pool.query('TRUNCATE TABLE alert_trigger_events, alert_rules, line_webhook_events, instrument_quotes, transactions, transaction_drafts, position_snapshots, instruments, portfolios, user_identities, users CASCADE');
  });
  afterAll(async () => pool.end());

  it('creates owned STOP_LOSS and TAKE_PROFIT rules and lists only the owned portfolio', async () => {
    const f = await fixture(); await transaction(f, 'BUY');
    expect((await createRule(f, 'STOP_LOSS')).type).toBe('STOP_LOSS');
    expect((await createRule(f, 'TAKE_PROFIT', '1400')).type).toBe('TAKE_PROFIT');
    expect(await alerts.listPortfolioAlertRules(f.portfolio.id, f.user.id)).toHaveLength(2);
    await expect(alerts.listPortfolioAlertRules(f.portfolio.id, f.otherUser.id)).rejects.toThrow(ApplicationAuthorizationError);
  });

  it('rejects rules without a positive position and invalid trigger prices', async () => {
    const f = await fixture();
    await expect(createRule(f)).rejects.toThrow(ApplicationConflictError);
    await transaction(f, 'BUY');
    for (const price of ['0', '-1', 'not-a-price']) await expect(createRule(f, 'STOP_LOSS', price)).rejects.toThrow(DomainValidationError);
  });

  it.each([['1199', 'below'], ['1200', 'equal']])('triggers STOP_LOSS when price is %s (%s threshold)', async (price) => {
    const f = await fixture(); await transaction(f, 'BUY'); const rule = await createRule(f); await quote(f, price);
    expect((await alerts.evaluateAlertRule(rule.id, f.user.id)).result).toBe('TRIGGERED');
  });

  it.each([['1401', 'above'], ['1400', 'equal']])('triggers TAKE_PROFIT when price is %s (%s threshold)', async (price) => {
    const f = await fixture(); await transaction(f, 'BUY'); const rule = await createRule(f, 'TAKE_PROFIT', '1400'); await quote(f, price);
    expect((await alerts.evaluateAlertRule(rule.id, f.user.id)).result).toBe('TRIGGERED');
  });

  it('skips stale and missing quotes without changing condition state', async () => {
    const f = await fixture(); await transaction(f, 'BUY'); const rule = await createRule(f);
    expect((await alerts.evaluateAlertRule(rule.id, f.user.id)).result).toBe('SKIPPED_MISSING');
    expect((await alerts.getAlertRule(rule.id, f.user.id)).conditionState).toBe('CLEAR');
    await quote(f, '1100', new Date(now.getTime() - 5 * 60 * 1000 - 1));
    expect((await alerts.evaluateAlertRule(rule.id, f.user.id)).result).toBe('SKIPPED_STALE');
    expect((await alerts.getAlertRule(rule.id, f.user.id)).conditionState).toBe('CLEAR');
  });

  it('triggers only on CLEAR to BREACHED, re-arms on recovery, then triggers a second crossing', async () => {
    const f = await fixture(); await transaction(f, 'BUY'); const rule = await createRule(f);
    await quote(f, '1190'); expect((await alerts.evaluateAlertRule(rule.id, f.user.id)).result).toBe('TRIGGERED');
    now = new Date(now.getTime() + 60_000); await quote(f, '1180'); expect((await alerts.evaluateAlertRule(rule.id, f.user.id)).result).toBe('ALREADY_BREACHED');
    expect(await repository.listAlertTriggerEvents(rule.id)).toHaveLength(1);
    now = new Date(now.getTime() + 60_000); await quote(f, '1210'); expect((await alerts.evaluateAlertRule(rule.id, f.user.id)).result).toBe('CLEAR');
    now = new Date(now.getTime() + 60_000); await quote(f, '1190'); expect((await alerts.evaluateAlertRule(rule.id, f.user.id)).result).toBe('TRIGGERED');
    expect(await repository.listAlertTriggerEvents(rule.id)).toHaveLength(2);
  });

  it('creates one event when the same rule and quote are evaluated concurrently', async () => {
    const f = await fixture(); await transaction(f, 'BUY'); const rule = await createRule(f); await quote(f, '1190');
    const results = await Promise.all([alerts.evaluateAlertRule(rule.id, f.user.id), alerts.evaluateAlertRule(rule.id, f.user.id)]);
    expect(results.map(({ result }) => result).sort()).toEqual(['ALREADY_BREACHED', 'TRIGGERED']);
    expect(await repository.listAlertTriggerEvents(rule.id)).toHaveLength(1);
  });

  it('supports pause, reset-on-resume, and permanent archive without evaluation', async () => {
    const f = await fixture(); await transaction(f, 'BUY'); const rule = await createRule(f); await quote(f, '1100');
    await alerts.pauseAlertRule(rule.id, f.user.id); expect((await alerts.evaluateAlertRule(rule.id, f.user.id)).result).toBe('SKIPPED_PAUSED');
    expect((await alerts.resumeAlertRule(rule.id, f.user.id)).conditionState).toBe('CLEAR');
    expect((await alerts.evaluateAlertRule(rule.id, f.user.id)).result).toBe('TRIGGERED');
    await alerts.archiveAlertRule(rule.id, f.user.id); expect((await alerts.evaluateAlertRule(rule.id, f.user.id)).result).toBe('SKIPPED_ARCHIVED');
    await expect(alerts.resumeAlertRule(rule.id, f.user.id)).rejects.toThrow(ApplicationConflictError);
  });

  it('prevents another user from viewing, modifying, or evaluating a rule', async () => {
    const f = await fixture(); await transaction(f, 'BUY'); const rule = await createRule(f);
    await expect(alerts.getAlertRule(rule.id, f.otherUser.id)).rejects.toThrow(ApplicationAuthorizationError);
    await expect(alerts.updateAlertTriggerPrice(rule.id, f.otherUser.id, '1100')).rejects.toThrow(ApplicationAuthorizationError);
    await expect(alerts.pauseAlertRule(rule.id, f.otherUser.id)).rejects.toThrow(ApplicationAuthorizationError);
    await expect(alerts.evaluateAlertRule(rule.id, f.otherUser.id)).rejects.toThrow(ApplicationAuthorizationError);
  });

  it('rejects currency mismatch during creation and evaluation', async () => {
    const f = await fixture(); await transaction(f, 'BUY');
    await expect(alerts.createAlertRule({ userId: f.user.id, portfolioId: f.portfolio.id, instrumentId: f.instrument.id, type: 'STOP_LOSS', triggerPrice: '1200', currency: 'USD' })).rejects.toThrow(DomainValidationError);
    const rule = await createRule(f); await quote(f, '1100', undefined, 'USD');
    await expect(alerts.evaluateAlertRule(rule.id, f.user.id)).rejects.toThrow('currencies do not match');
  });

  it('returns SKIPPED_NO_POSITION after a full sell without deleting the rule', async () => {
    const f = await fixture(); await transaction(f, 'BUY'); const rule = await createRule(f); await transaction(f, 'SELL'); await quote(f, '1100');
    expect((await alerts.evaluateAlertRule(rule.id, f.user.id)).result).toBe('SKIPPED_NO_POSITION');
    expect((await alerts.getAlertRule(rule.id, f.user.id)).status).toBe('ACTIVE');
  });

  it('resets state when updating threshold but waits for the next evaluation to trigger', async () => {
    const f = await fixture(); await transaction(f, 'BUY'); const rule = await createRule(f); await quote(f, '1190'); await alerts.evaluateAlertRule(rule.id, f.user.id);
    const eventsBefore = await repository.listAlertTriggerEvents(rule.id);
    const updated = await alerts.updateAlertTriggerPrice(rule.id, f.user.id, '1350');
    expect(updated.conditionState).toBe('CLEAR'); expect(await repository.listAlertTriggerEvents(rule.id)).toEqual(eventsBefore);
    now = new Date(now.getTime() + 60_000); await quote(f, '1300'); expect((await alerts.evaluateAlertRule(rule.id, f.user.id)).result).toBe('TRIGGERED');
  });

  it('preserves event prices and transaction accounting without creating trades', async () => {
    const f = await fixture(); await transaction(f, 'BUY'); await transaction(f, 'SELL', '20', '1400'); const rule = await createRule(f); const storedQuote = await quote(f, '1100');
    const before = await repository.listTransactions(f.portfolio.id); const result = await alerts.evaluateAlertRule(rule.id, f.user.id);
    expect(result.event).toMatchObject({ quoteId: storedQuote.id, observedPrice: '1100', triggerPrice: '1200' });
    const after = await repository.listTransactions(f.portfolio.id); expect(after).toEqual(before);
    expect(calculatePositions(after.map((item) => ({ ...item, reversalOf: item.reversalOf, note: item.note })), f.portfolio.id).get(f.instrument.id)?.realizedPnl.toString()).toBe('3000');
  });

  it('uses Decimal-safe threshold comparisons', async () => {
    const f = await fixture(); await transaction(f, 'BUY', '1', '1'); const rule = await createRule(f, 'STOP_LOSS', '0.300000000001');
    await quote(f, '0.300000000002'); expect((await alerts.evaluateAlertRule(rule.id, f.user.id)).result).toBe('CLEAR');
    now = new Date(now.getTime() + 60_000); await quote(f, '0.300000000001'); expect((await alerts.evaluateAlertRule(rule.id, f.user.id)).result).toBe('TRIGGERED');
  });
});
