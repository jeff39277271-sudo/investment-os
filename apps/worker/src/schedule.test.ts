import { describe, expect, it, vi } from 'vitest';
import type { AlertRuleRecord, InstrumentRecord } from '@investment-os/db';
import { MarketSessionPolicy } from './market-session.js';
import { ScheduledAlertRunner, type SchedulerRepository, type ScheduledWorker } from './schedule.js';

const now = new Date('2026-08-31T01:00:00.000Z');
const rule = { id: 'rule', instrumentId: 'instrument', userId: 'user' } as AlertRuleRecord;
const instrument = { id: 'instrument', market: 'TW', exchange: 'TWSE' } as InstrumentRecord;
const summary = { rulesEvaluated: 1, quotesRefreshed: 1, quoteFailures: 0, alertsTriggered: 0, notificationsDelivered: 0, notificationsFailed: 0 };

function dependencies(overrides: Partial<SchedulerRepository> = {}) {
  const repository: SchedulerRepository = {
    listActiveAlertRules: vi.fn(async () => [rule]), getInstrument: vi.fn(async () => instrument),
    acquireSchedulerLease: vi.fn(async () => true), renewSchedulerLease: vi.fn(async () => true), releaseSchedulerLease: vi.fn(async () => {}),
    ...overrides,
  };
  const worker: ScheduledWorker = { runOnce: vi.fn(async () => summary) };
  const logs: unknown[] = [];
  const runner = new ScheduledAlertRunner(repository, worker, new MarketSessionPolicy(), { intervalMs: 1000, leaseMs: 5000, ownerId: 'owner', clock: () => now, logger: { log: (event) => logs.push(event) } });
  return { repository, worker, runner, logs };
}

describe('scheduled alert runner', () => {
  it('runs the existing worker for open instruments and emits a safe summary', async () => {
    const { repository, worker, runner, logs } = dependencies();
    expect(await runner.tick()).toMatchObject({ result: 'COMPLETED', marketStatus: 'OPEN', summary });
    expect(worker.runOnce).toHaveBeenCalledWith({ instrumentIds: ['instrument'] });
    expect(vi.mocked(repository.acquireSchedulerLease).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(worker.runOnce).mock.invocationCallOrder[0]!);
    expect(repository.releaseSchedulerLease).toHaveBeenCalledOnce();
    expect(JSON.stringify(logs)).not.toMatch(/DATABASE_URL|LINE_CHANNEL_ACCESS_TOKEN|FUGLE_API_KEY|Bearer/);
  });

  it('does no worker, lock, market-data or LINE work when market is closed', async () => {
    const closed = dependencies();
    const runner = new ScheduledAlertRunner(closed.repository, closed.worker, new MarketSessionPolicy(), { intervalMs: 1000, leaseMs: 5000, ownerId: 'owner', clock: () => new Date('2026-08-31T00:59:59Z'), logger: { log() {} } });
    expect(await runner.tick()).toMatchObject({ result: 'SKIPPED_MARKET_CLOSED' });
    expect(closed.worker.runOnce).not.toHaveBeenCalled(); expect(closed.repository.acquireSchedulerLease).not.toHaveBeenCalled();
  });

  it('skips unsupported markets and a held distributed lock observably', async () => {
    const unsupported = dependencies({ getInstrument: vi.fn(async () => ({ ...instrument, market: 'US', exchange: 'NASDAQ' })) });
    expect(await unsupported.runner.tick()).toMatchObject({ result: 'SKIPPED_UNSUPPORTED_MARKET', marketStatus: 'UNSUPPORTED' });
    const held = dependencies({ acquireSchedulerLease: vi.fn(async () => false) });
    expect(await held.runner.tick()).toMatchObject({ result: 'SKIPPED_LOCK_HELD' }); expect(held.worker.runOnce).not.toHaveBeenCalled();
  });

  it('does not overlap and sleeps only after the prior run completes', async () => {
    let resolveRun!: () => void; let active = 0; let maximum = 0;
    const runPromise = new Promise<void>((resolve) => { resolveRun = resolve; });
    const worker: ScheduledWorker = { runOnce: vi.fn(async () => { active += 1; maximum = Math.max(maximum, active); await runPromise; active -= 1; return summary; }) };
    const base = dependencies(); let sleeps = 0;
    const runner = new ScheduledAlertRunner(base.repository, worker, new MarketSessionPolicy(), { intervalMs: 1000, leaseMs: 5000, ownerId: 'owner', clock: () => now, sleep: async () => { sleeps += 1; runner.stop(); }, logger: { log() {} } });
    const running = runner.start(); await vi.waitFor(() => expect(worker.runOnce).toHaveBeenCalledOnce());
    expect(sleeps).toBe(0); expect(worker.runOnce).toHaveBeenCalledOnce(); resolveRun(); await running;
    expect(maximum).toBe(1); expect(sleeps).toBe(1);
  });

  it('continues on the next cadence after a temporary worker failure', async () => {
    const base = dependencies(); let attempts = 0;
    const worker: ScheduledWorker = { runOnce: vi.fn(async () => { attempts += 1; if (attempts === 1) throw new Error('temporary'); return summary; }) };
    const runner = new ScheduledAlertRunner(base.repository, worker, new MarketSessionPolicy(), { intervalMs: 1000, leaseMs: 5000, ownerId: 'owner', clock: () => now, sleep: async () => { if (attempts === 2) runner.stop(); }, logger: { log() {} } });
    await runner.start(); expect(attempts).toBe(2);
  });

  it('continues after a temporary scheduler repository failure', async () => {
    let reads = 0;
    const base = dependencies({ listActiveAlertRules: vi.fn(async () => { reads += 1; if (reads === 1) throw new Error('temporary database error'); return [rule]; }) });
    const runner = new ScheduledAlertRunner(base.repository, base.worker, new MarketSessionPolicy(), { intervalMs: 1000, leaseMs: 5000, ownerId: 'owner', clock: () => now, sleep: async () => { if (reads === 2) runner.stop(); }, logger: { log() {} } });
    await runner.start(); expect(reads).toBe(2); expect(base.worker.runOnce).toHaveBeenCalledOnce();
  });
});
