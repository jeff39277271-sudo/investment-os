import type { InstrumentRecord, InvestmentRepository } from '@investment-os/db';
import type { AlertWorkerRunOptions, AlertWorkerSummary } from './index.js';
import { MarketSessionPolicy } from './market-session.js';

export type SchedulerTickResult =
  | { result: 'COMPLETED'; marketStatus: 'OPEN'; durationMs: number; summary: AlertWorkerSummary }
  | { result: 'SKIPPED_MARKET_CLOSED' | 'SKIPPED_UNSUPPORTED_MARKET' | 'SKIPPED_NO_ACTIVE_RULES' | 'SKIPPED_LOCK_HELD'; marketStatus: 'CLOSED' | 'UNSUPPORTED' | 'NO_RULES' | 'OPEN'; durationMs: number }
  | { result: 'FAILED'; marketStatus: 'OPEN' | 'UNKNOWN'; durationMs: number; errorCode: 'WORKER_FAILED' | 'SCHEDULER_TICK_FAILED' };

export type SchedulerLogEvent = SchedulerTickResult & { timestamp: string; job: 'ALERT_MONITORING' };
export interface ScheduledWorker { runOnce(options?: AlertWorkerRunOptions): Promise<AlertWorkerSummary> }
export type SchedulerRepository = Pick<InvestmentRepository,
  'listActiveAlertRules' | 'getInstrument' | 'acquireSchedulerLease' | 'renewSchedulerLease' | 'releaseSchedulerLease'>;
export type SchedulerLogger = { log(event: SchedulerLogEvent): void };
export type SchedulerSleep = (milliseconds: number, signal: AbortSignal) => Promise<void>;

const defaultSleep: SchedulerSleep = (milliseconds, signal) => new Promise((resolve) => {
  if (signal.aborted) { resolve(); return; }
  const timeout = setTimeout(resolve, milliseconds);
  signal.addEventListener('abort', () => { clearTimeout(timeout); resolve(); }, { once: true });
});

export type ScheduledAlertRunnerOptions = {
  intervalMs: number; leaseMs: number; ownerId: string; clock?: () => Date;
  sleep?: SchedulerSleep; logger?: SchedulerLogger;
};

export class ScheduledAlertRunner {
  static readonly jobName = 'ALERT_MONITORING';
  private readonly clock: () => Date;
  private readonly sleep: SchedulerSleep;
  private readonly logger: SchedulerLogger;
  private readonly stopController = new AbortController();
  private stopped = false;

  constructor(
    private readonly repository: SchedulerRepository,
    private readonly worker: ScheduledWorker,
    private readonly marketSessions: MarketSessionPolicy,
    private readonly options: ScheduledAlertRunnerOptions,
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.sleep = options.sleep ?? defaultSleep;
    this.logger = options.logger ?? { log: (event) => console.log(JSON.stringify(event)) };
  }

  async start(): Promise<void> {
    while (!this.stopped) {
      const startedAt = this.clock();
      try { await this.tick(); }
      catch { this.emit({ result: 'FAILED', marketStatus: 'UNKNOWN', durationMs: this.duration(startedAt), errorCode: 'SCHEDULER_TICK_FAILED' }); }
      if (!this.stopped) await this.sleep(this.options.intervalMs, this.stopController.signal);
    }
  }

  stop(): void { this.stopped = true; this.stopController.abort(); }

  async tick(): Promise<SchedulerTickResult> {
    const startedAt = this.clock();
    const rules = await this.repository.listActiveAlertRules();
    if (rules.length === 0) return this.emit({ result: 'SKIPPED_NO_ACTIVE_RULES', marketStatus: 'NO_RULES', durationMs: this.duration(startedAt) });
    const instrumentIds = [...new Set(rules.map(({ instrumentId }) => instrumentId))];
    const instruments = (await Promise.all(instrumentIds.map((id) => this.repository.getInstrument(id)))).filter((value): value is InstrumentRecord => Boolean(value));
    const evaluations = instruments.map((instrument) => ({ instrument, session: this.marketSessions.evaluate(instrument, startedAt) }));
    const openInstrumentIds = evaluations.filter(({ session }) => session.status === 'OPEN').map(({ instrument }) => instrument.id);
    if (openInstrumentIds.length === 0) {
      const unsupportedOnly = evaluations.length > 0 && evaluations.every(({ session }) => session.status === 'UNSUPPORTED');
      return this.emit({ result: unsupportedOnly ? 'SKIPPED_UNSUPPORTED_MARKET' : 'SKIPPED_MARKET_CLOSED', marketStatus: unsupportedOnly ? 'UNSUPPORTED' : 'CLOSED', durationMs: this.duration(startedAt) });
    }
    const acquired = await this.repository.acquireSchedulerLease(ScheduledAlertRunner.jobName, this.options.ownerId, startedAt, new Date(startedAt.getTime() + this.options.leaseMs));
    if (!acquired) return this.emit({ result: 'SKIPPED_LOCK_HELD', marketStatus: 'OPEN', durationMs: this.duration(startedAt) });

    const heartbeat = this.startHeartbeat();
    try {
      const summary = await this.worker.runOnce({ instrumentIds: openInstrumentIds });
      return this.emit({ result: 'COMPLETED', marketStatus: 'OPEN', durationMs: this.duration(startedAt), summary });
    } catch {
      return this.emit({ result: 'FAILED', marketStatus: 'OPEN', durationMs: this.duration(startedAt), errorCode: 'WORKER_FAILED' });
    } finally {
      await heartbeat.stop();
      await this.repository.releaseSchedulerLease(ScheduledAlertRunner.jobName, this.options.ownerId, this.clock());
    }
  }

  private startHeartbeat(): { stop: () => Promise<void> } {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = Promise.resolve();
    const schedule = () => {
      timer = setTimeout(() => {
        if (stopped) return;
        const now = this.clock();
        pending = this.repository.renewSchedulerLease(ScheduledAlertRunner.jobName, this.options.ownerId, now, new Date(now.getTime() + this.options.leaseMs))
          .then(() => schedule()).catch(() => undefined);
      }, Math.max(1000, Math.floor(this.options.leaseMs / 3)));
    };
    schedule();
    return { stop: async () => { stopped = true; if (timer) clearTimeout(timer); await pending; } };
  }

  private duration(startedAt: Date): number { return Math.max(0, this.clock().getTime() - startedAt.getTime()); }
  private emit(result: SchedulerTickResult): SchedulerTickResult {
    this.logger.log({ timestamp: this.clock().toISOString(), job: ScheduledAlertRunner.jobName, ...result });
    return result;
  }
}
