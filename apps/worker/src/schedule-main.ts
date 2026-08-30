import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { AlertApplicationService, MarketDataApplicationService } from '@investment-os/application';
import { createRepositoryRuntime } from '@investment-os/db';
import { LineMessagingApiClient } from '@investment-os/line-ui';
import { createConfiguredMarketDataProvider, QuoteFreshnessPolicy } from '@investment-os/market-data';
import { AlertMonitoringWorker } from './index.js';
import { MarketSessionPolicy, parseClosedMarketDates } from './market-session.js';
import { ScheduledAlertRunner } from './schedule.js';
import { readAlertWorkerConfig, type AlertWorkerConfig } from './main.js';

export type AlertSchedulerConfig = AlertWorkerConfig & { intervalMs: number; leaseMs: number; closedDates: ReadonlySet<string> };

function positiveInteger(value: string, name: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${name} must be a safe integer of at least ${minimum}`);
  return parsed;
}

export function readAlertSchedulerConfig(env: NodeJS.ProcessEnv): AlertSchedulerConfig {
  const worker = readAlertWorkerConfig(env);
  const intervalMs = positiveInteger(env.ALERT_MONITOR_INTERVAL_MS?.trim() || '60000', 'ALERT_MONITOR_INTERVAL_MS', 1000);
  const defaultLease = Math.max(120000, intervalMs * 2);
  const leaseMs = positiveInteger(env.ALERT_SCHEDULER_LEASE_MS?.trim() || String(defaultLease), 'ALERT_SCHEDULER_LEASE_MS', 5000);
  return { ...worker, intervalMs, leaseMs, closedDates: parseClosedMarketDates(env.TW_MARKET_CLOSED_DATES) };
}

export class AlertSchedulerRuntime {
  constructor(private readonly runner: Pick<ScheduledAlertRunner, 'start' | 'stop'>, private readonly closeResources: () => Promise<void>) {}
  async start(): Promise<void> { try { await this.runner.start(); } finally { await this.closeResources(); } }
  shutdown(): void { this.runner.stop(); }
}

export function createConfiguredAlertScheduler(env: NodeJS.ProcessEnv = process.env): AlertSchedulerRuntime {
  const config = readAlertSchedulerConfig(env);
  const provider = createConfiguredMarketDataProvider({ environment: config.environment, provider: config.provider, apiKey: config.fugleApiKey });
  const line = new LineMessagingApiClient(config.lineAccessToken);
  const runtime = createRepositoryRuntime(config.databaseUrl);
  const freshness = new QuoteFreshnessPolicy(config.staleAfterMs);
  const worker = new AlertMonitoringWorker(
    runtime.repository,
    new MarketDataApplicationService(runtime.repository, freshness),
    new AlertApplicationService(runtime.repository, freshness),
    provider, line,
  );
  const runner = new ScheduledAlertRunner(runtime.repository, worker, new MarketSessionPolicy(config.closedDates), {
    intervalMs: config.intervalMs, leaseMs: config.leaseMs, ownerId: randomUUID(),
  });
  return new AlertSchedulerRuntime(runner, runtime.close);
}

async function main(): Promise<void> {
  let scheduler: AlertSchedulerRuntime | undefined;
  const shutdown = () => scheduler?.shutdown();
  try {
    scheduler = createConfiguredAlertScheduler();
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    await scheduler.start();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Alert scheduler failed'); process.exitCode = 1;
  } finally {
    process.off('SIGINT', shutdown); process.off('SIGTERM', shutdown);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
