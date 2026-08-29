import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ApplicationAuthorizationError, ApplicationConflictError, type LineApplicationService, type TransactionApplicationService } from '@investment-os/application';
import { transactionConfirmationFlex, type LineMessage } from '@investment-os/line-ui';

export interface LineMessagingClient { reply(replyToken: string, messages: readonly LineMessage[]): Promise<void> }
export class LineMessagingApiClient implements LineMessagingClient {
  constructor(private readonly channelAccessToken: string, private readonly fetcher: typeof fetch = fetch) {}
  async reply(replyToken: string, messages: readonly LineMessage[]): Promise<void> {
    const response = await this.fetcher('https://api.line.me/v2/bot/message/reply', { method: 'POST', headers: { authorization: `Bearer ${this.channelAccessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ replyToken, messages }) });
    if (!response.ok) throw new Error(`LINE reply failed with status ${response.status}`);
  }
}
export class FakeLineMessagingClient implements LineMessagingClient {
  readonly replies: { replyToken: string; messages: readonly LineMessage[] }[] = [];
  async reply(replyToken: string, messages: readonly LineMessage[]): Promise<void> { this.replies.push({ replyToken, messages }); }
}
export function verifyLineSignature(rawBody: Buffer, signature: string | undefined, channelSecret: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(createHmac('sha256', channelSecret).update(rawBody).digest('base64')); const supplied = Buffer.from(signature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
export type TransactionCommand = { side: 'BUY' | 'SELL'; symbol: string; quantity: string; price: string };
export function parseTransactionCommand(text: string): TransactionCommand | undefined {
  const match = text.trim().match(/^(BUY|SELL|買|賣)\s+([A-Z0-9.-]+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/i);
  if (!match) return undefined;
  return { side: /^(BUY|買)$/i.test(match[1]) ? 'BUY' : 'SELL', symbol: match[2].toUpperCase(), quantity: match[3], price: match[4] };
}
type LineEvent = { type: string; webhookEventId?: string; replyToken?: string; source?: { type?: string; userId?: string }; message?: { type?: string; text?: string }; postback?: { data?: string } };
type LineWebhookBody = { events?: LineEvent[] };
export class LineWebhookAdapter {
  constructor(private readonly lineApplication: LineApplicationService, private readonly transactions: TransactionApplicationService, private readonly messaging: LineMessagingClient, private readonly clock: () => Date = () => new Date()) {}
  async handle(rawBody: Buffer): Promise<void> { const body = JSON.parse(rawBody.toString('utf8')) as LineWebhookBody; for (const event of body.events ?? []) await this.handleEvent(event); }
  private async handleEvent(event: LineEvent): Promise<void> {
    if (!event.webhookEventId) throw new ApplicationConflictError('LINE webhookEventId is required');
    const providerUserId = event.source?.type === 'user' ? event.source.userId : undefined;
    const identityHash = providerUserId ? createHash('sha256').update(providerUserId).digest('hex') : undefined;
    if (!(await this.lineApplication.claimWebhookEvent(event.webhookEventId, event.type, identityHash))) return;
    try {
      if (!providerUserId || !event.replyToken) throw new ApplicationAuthorizationError('LINE event has no trusted user source or reply token');
      const context = await this.lineApplication.getOrCreateIdentity(providerUserId);
      if (event.type === 'message' && event.message?.type === 'text' && event.message.text) await this.handleText(event.message.text, event.replyToken, event.webhookEventId, context.user.id, context.portfolio.id);
      else if (event.type === 'postback' && event.postback?.data) await this.handlePostback(event.postback.data, event.replyToken, event.webhookEventId, context.user.id);
      await this.lineApplication.completeWebhookEvent(event.webhookEventId);
    } catch (error) { await this.lineApplication.failWebhookEvent(event.webhookEventId, error); throw error; }
  }
  private async handleText(text: string, replyToken: string, eventId: string, userId: string, portfolioId: string): Promise<void> {
    const normalized = text.trim().toLowerCase();
    if (normalized === '確認' || normalized === 'confirm') return this.actOnLatest('confirm', replyToken, eventId, userId);
    if (normalized === '取消' || normalized === 'cancel') return this.actOnLatest('cancel', replyToken, eventId, userId);
    const command = parseTransactionCommand(text);
    if (!command) return this.messaging.reply(replyToken, [{ type: 'text', text: '無法解析指令。請使用：BUY 2330 100 1250 或 SELL 2330 50 1300' }]);
    const instrument = await this.lineApplication.findInstrument(command.symbol);
    if (!instrument) return this.messaging.reply(replyToken, [{ type: 'text', text: `找不到商品 ${command.symbol}，未建立交易草稿。` }]);
    const draft = await this.transactions.createTransactionDraft({ userId, portfolioId, instrumentId: instrument.id, side: command.side, quantity: command.quantity, price: command.price, tradeAt: this.clock(), currency: instrument.currency, fee: '0', tax: '0', source: 'LINE', idempotencyKey: `line-event:${eventId}` });
    await this.messaging.reply(replyToken, [transactionConfirmationFlex({ draftId: draft.id, symbol: instrument.symbol, instrumentName: instrument.name, side: draft.side, quantity: draft.quantity, price: draft.price, currency: draft.currency, fee: draft.fee, tax: draft.tax })]);
  }
  private async actOnLatest(action: 'confirm' | 'cancel', replyToken: string, eventId: string, userId: string): Promise<void> {
    const draft = await this.lineApplication.findLatestActiveDraft(userId);
    if (!draft) return this.messaging.reply(replyToken, [{ type: 'text', text: '目前沒有可處理的交易草稿。' }]);
    return this.act(action, draft.id, replyToken, eventId, userId);
  }
  private async handlePostback(data: string, replyToken: string, eventId: string, userId: string): Promise<void> {
    const values = new URLSearchParams(data); const action = values.get('action'); const draftId = values.get('draftId');
    if ((action !== 'confirm' && action !== 'cancel') || !draftId) throw new ApplicationConflictError('invalid LINE postback');
    return this.act(action, draftId, replyToken, eventId, userId);
  }
  private async act(action: 'confirm' | 'cancel', draftId: string, replyToken: string, eventId: string, userId: string): Promise<void> {
    if (action === 'confirm') { await this.transactions.confirmTransaction(draftId, userId, `line-event:${eventId}`); await this.messaging.reply(replyToken, [{ type: 'text', text: '交易已確認並記錄。' }]); }
    else { await this.transactions.cancelDraft(draftId, userId); await this.messaging.reply(replyToken, [{ type: 'text', text: '交易草稿已取消。' }]); }
  }
}
