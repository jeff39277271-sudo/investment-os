import { AlertApplicationService, MarketDataApplicationService } from '@investment-os/application';
import type { InvestmentRepository } from '@investment-os/db';
import { alertNotificationText, LineMessagingError, type LineMessagingClient } from '@investment-os/line-ui';
import type { MarketDataProvider } from '@investment-os/market-data';

export type AlertWorkerSummary = {
  rulesEvaluated: number; quotesRefreshed: number; quoteFailures: number; alertsTriggered: number;
  notificationsDelivered: number; notificationsFailed: number;
};
export type AlertMonitoringWorkerOptions = { maxDeliveryAttempts?: number; processingLeaseMs?: number; clock?: () => Date };

export class AlertMonitoringWorker {
  private readonly maxDeliveryAttempts: number;
  private readonly processingLeaseMs: number;
  private readonly clock: () => Date;

  constructor(
    private readonly repository: InvestmentRepository,
    private readonly marketData: MarketDataApplicationService,
    private readonly alerts: AlertApplicationService,
    private readonly provider: MarketDataProvider,
    private readonly line: LineMessagingClient,
    options: AlertMonitoringWorkerOptions = {},
  ) {
    this.maxDeliveryAttempts = options.maxDeliveryAttempts ?? 3;
    this.processingLeaseMs = options.processingLeaseMs ?? 5 * 60 * 1000;
    this.clock = options.clock ?? (() => new Date());
  }

  async runOnce(): Promise<AlertWorkerSummary> {
    const summary: AlertWorkerSummary = { rulesEvaluated: 0, quotesRefreshed: 0, quoteFailures: 0, alertsTriggered: 0, notificationsDelivered: 0, notificationsFailed: 0 };
    const rules = await this.repository.listActiveAlertRules();
    const refreshSucceeded = new Set<string>();
    const instrumentIds = [...new Set(rules.map(({ instrumentId }) => instrumentId))];
    for (const instrumentId of instrumentIds) {
      try { await this.marketData.refreshQuote(instrumentId, this.provider); refreshSucceeded.add(instrumentId); summary.quotesRefreshed += 1; }
      catch { summary.quoteFailures += 1; }
    }
    for (const rule of rules) {
      if (!refreshSucceeded.has(rule.instrumentId)) continue;
      try {
        const outcome = await this.alerts.evaluateAlertRule(rule.id, rule.userId);
        summary.rulesEvaluated += 1;
        if (outcome.event) summary.alertsTriggered += 1;
      } catch { /* Isolate one invalid rule from the rest of the run. */ }
    }

    summary.notificationsFailed += await this.createMissingDeliveries();
    const leaseExpiredBefore = new Date(this.clock().getTime() - this.processingLeaseMs);
    const ids = await this.repository.listDispatchableLineDeliveryIds(this.maxDeliveryAttempts, leaseExpiredBefore);
    for (const id of ids) {
      const now = this.clock();
      const claimed = await this.repository.claimLineNotificationDelivery(id, this.maxDeliveryAttempts, now, new Date(now.getTime() - this.processingLeaseMs));
      if (!claimed) continue;
      const context = await this.repository.getNotificationDeliveryContext(id);
      if (!context?.recipient || context.recipient.provider !== 'LINE' || context.recipient.userId !== context.delivery.userId) {
        await this.repository.failNotificationDelivery(id, 'NO_RECIPIENT', false, this.clock()); summary.notificationsFailed += 1; continue;
      }
      try {
        await this.line.push(context.recipient.providerSubject, [alertNotificationText({
          type: context.rule.type, symbol: context.instrument.symbol, instrumentName: context.instrument.name,
          observedPrice: context.event.observedPrice, triggerPrice: context.event.triggerPrice,
          currency: context.rule.currency, quoteAt: context.event.quoteAt, source: context.quote.source,
        })], context.delivery.id);
        await this.repository.completeNotificationDelivery(id, this.clock()); summary.notificationsDelivered += 1;
      } catch (error) {
        const classified = error instanceof LineMessagingError ? error : new LineMessagingError('NETWORK_ERROR', true, 'LINE delivery failed');
        await this.repository.failNotificationDelivery(id, classified.code, classified.retryable, this.clock()); summary.notificationsFailed += 1;
      }
    }
    return summary;
  }

  private async createMissingDeliveries(): Promise<number> {
    let missingRecipients = 0;
    for (const candidate of await this.repository.listAlertDeliveryCandidates()) {
      const recipient = await this.repository.findUserIdentityByUserId(candidate.rule.userId, 'LINE');
      await this.repository.ensureLineNotificationDelivery(candidate.event.id, candidate.rule.userId, recipient?.id, this.clock());
      if (!recipient) missingRecipients += 1;
    }
    return missingRecipients;
  }
}
