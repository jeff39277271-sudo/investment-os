import { describe, expect, it, vi } from 'vitest';
import { AlertSchedulerRuntime, createConfiguredAlertScheduler, readAlertSchedulerConfig } from './schedule-main.js';

const required = { DATABASE_URL: 'postgres://test', MARKET_DATA_PROVIDER: 'fake', LINE_CHANNEL_ACCESS_TOKEN: 'token' };

describe('alert scheduler runtime configuration and shutdown', () => {
  it('defaults cadence and lease and parses configured closed dates', () => {
    const config = readAlertSchedulerConfig({ ...required, TW_MARKET_CLOSED_DATES: '2026-01-01,2026-02-16' });
    expect(config).toMatchObject({ intervalMs: 60000, leaseMs: 120000, staleAfterMs: 300000 });
    expect([...config.closedDates]).toEqual(['2026-01-01', '2026-02-16']);
  });

  it('accepts safe overrides and rejects invalid or too-fast cadence', () => {
    expect(readAlertSchedulerConfig({ ...required, ALERT_MONITOR_INTERVAL_MS: '5000', ALERT_SCHEDULER_LEASE_MS: '15000' })).toMatchObject({ intervalMs: 5000, leaseMs: 15000 });
    for (const value of ['0', '999', '1.5', 'abc']) expect(() => readAlertSchedulerConfig({ ...required, ALERT_MONITOR_INTERVAL_MS: value })).toThrow('ALERT_MONITOR_INTERVAL_MS');
    expect(() => readAlertSchedulerConfig({ ...required, ALERT_SCHEDULER_LEASE_MS: '4999' })).toThrow('ALERT_SCHEDULER_LEASE_MS');
  });

  it('fails fast on worker configuration errors', () => {
    expect(() => readAlertSchedulerConfig({})).toThrow('DATABASE_URL');
    expect(() => readAlertSchedulerConfig({ DATABASE_URL: 'db', MARKET_DATA_PROVIDER: 'fake' })).toThrow('LINE_CHANNEL_ACCESS_TOKEN');
  });

  it('keeps production fake-provider prohibition', () => {
    expect(() => createConfiguredAlertScheduler({ ...required, NODE_ENV: 'production' })).toThrow('forbidden in production');
  });

  it('stops future ticks for either shutdown signal path and closes DB resources after in-flight start finishes', async () => {
    const runner = { start: vi.fn(async () => {}), stop: vi.fn() };
    const close = vi.fn(async () => {}); const runtime = new AlertSchedulerRuntime(runner, close);
    runtime.shutdown(); runtime.shutdown(); await runtime.start();
    expect(runner.stop).toHaveBeenCalledTimes(2); expect(runner.start).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });
});
