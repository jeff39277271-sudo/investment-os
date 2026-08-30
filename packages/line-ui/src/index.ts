import { Decimal } from 'decimal.js';

export type LineTextMessage = { type: 'text'; text: string };
export type LineFlexMessage = { type: 'flex'; altText: string; contents: Record<string, unknown> };
export type LineMessage = LineTextMessage | LineFlexMessage;
export type LinePush = { lineUserId: string; messages: readonly LineMessage[]; retryKey: string };
export type LineMessagingErrorCode = 'TIMEOUT' | 'NETWORK_ERROR' | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'INVALID_REQUEST' | 'AUTH_ERROR';
export class LineMessagingError extends Error {
  constructor(readonly code: LineMessagingErrorCode, readonly retryable: boolean, message: string) {
    super(message); this.name = 'LineMessagingError';
  }
}
export interface LineMessagingClient {
  reply(replyToken: string, messages: readonly LineMessage[]): Promise<void>;
  push(lineUserId: string, messages: readonly LineMessage[], retryKey: string): Promise<void>;
}

export class LineMessagingApiClient implements LineMessagingClient {
  constructor(private readonly channelAccessToken: string, private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 5000) {
    if (!channelAccessToken.trim()) throw new LineMessagingError('AUTH_ERROR', false, 'LINE channel access token is required');
  }
  async reply(replyToken: string, messages: readonly LineMessage[]): Promise<void> {
    await this.request('https://api.line.me/v2/bot/message/reply', { replyToken, messages });
  }
  async push(lineUserId: string, messages: readonly LineMessage[], retryKey: string): Promise<void> {
    await this.request('https://api.line.me/v2/bot/message/push', { to: lineUserId, messages }, retryKey);
  }
  private async request(url: string, body: object, retryKey?: string): Promise<void> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let response: Response;
    try {
      const request = this.fetcher(url, {
        method: 'POST', signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.channelAccessToken}`, 'content-type': 'application/json',
          ...(retryKey ? { 'x-line-retry-key': retryKey } : {}),
        },
        body: JSON.stringify(body),
      });
      const timeoutRequest = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(new LineMessagingError('TIMEOUT', true, 'LINE request timed out')); }, this.timeoutMs);
      });
      response = await Promise.race([request, timeoutRequest]);
    } catch (error) {
      if (error instanceof LineMessagingError) throw error;
      if (controller.signal.aborted) throw new LineMessagingError('TIMEOUT', true, 'LINE request timed out');
      throw new LineMessagingError('NETWORK_ERROR', true, 'LINE network request failed');
    } finally { if (timeout) clearTimeout(timeout); }
    if (response.ok || (retryKey && response.status === 409)) return;
    if (response.status === 429) throw new LineMessagingError('RATE_LIMITED', true, 'LINE rate limit exceeded');
    if (response.status >= 500) throw new LineMessagingError('PROVIDER_UNAVAILABLE', true, 'LINE service is unavailable');
    if (response.status === 401 || response.status === 403) throw new LineMessagingError('AUTH_ERROR', false, 'LINE authentication failed');
    throw new LineMessagingError('INVALID_REQUEST', false, `LINE request was rejected with status ${response.status}`);
  }
}

export class FakeLineMessagingClient implements LineMessagingClient {
  readonly replies: { replyToken: string; messages: readonly LineMessage[] }[] = [];
  readonly pushes: LinePush[] = [];
  async reply(replyToken: string, messages: readonly LineMessage[]): Promise<void> { this.replies.push({ replyToken, messages }); }
  async push(lineUserId: string, messages: readonly LineMessage[], retryKey: string): Promise<void> { this.pushes.push({ lineUserId, messages, retryKey }); }
}
export type TransactionConfirmationView = { draftId: string; symbol: string; instrumentName?: string; side: 'BUY' | 'SELL'; quantity: string; price: string; currency: string; fee: string; tax: string };

const number = (value: string) => new Decimal(value).toDecimalPlaces(12).toNumber().toLocaleString('zh-TW', { maximumFractionDigits: 12 });
const row = (label: string, value: string) => ({ type: 'box', layout: 'baseline', spacing: 'sm', contents: [
  { type: 'text', text: label, color: '#8B949E', size: 'sm', flex: 3 },
  { type: 'text', text: value, color: '#F0F3F6', size: 'sm', align: 'end', flex: 5 },
] });

export function transactionConfirmationFlex(view: TransactionConfirmationView): LineFlexMessage {
  const total = new Decimal(view.quantity).mul(view.price).add(view.fee).add(view.tax).toString();
  const name = view.instrumentName ? `${view.instrumentName} ${view.symbol}` : view.symbol;
  return { type: 'flex', altText: `交易確認：${view.side} ${view.symbol} ${view.quantity}`, contents: {
    type: 'bubble', styles: { body: { backgroundColor: '#111418' }, footer: { backgroundColor: '#111418' } },
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
      { type: 'text', text: '交易確認', weight: 'bold', size: 'xl', color: '#F0F3F6' },
      { type: 'text', text: name, size: 'md', color: '#C9D1D9' }, { type: 'separator', color: '#30363D' },
      row('方向', view.side === 'BUY' ? '買進 BUY' : '賣出 SELL'), row('數量', `${number(view.quantity)} 股`),
      row('價格', `${view.currency} ${number(view.price)}`), row('手續費', `${view.currency} ${number(view.fee)}`),
      row('稅額', `${view.currency} ${number(view.tax)}`), row('預估總額', `${view.currency} ${number(total)}`),
    ] },
    footer: { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
      { type: 'button', style: 'primary', color: '#238636', action: { type: 'postback', label: '確認', data: `action=confirm&draftId=${view.draftId}`, displayText: '確認' } },
      { type: 'button', style: 'secondary', action: { type: 'postback', label: '取消', data: `action=cancel&draftId=${view.draftId}`, displayText: '取消' } },
    ] },
  } };
}

export type AlertNotificationView = {
  type: 'STOP_LOSS' | 'TAKE_PROFIT'; symbol: string; instrumentName: string;
  observedPrice: string; triggerPrice: string; currency: string; quoteAt: Date; source: string;
};

function displayDecimal(value: string): string {
  const fixed = new Decimal(value).toFixed(12);
  const [integer, fraction] = fixed.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1').split('.');
  const grouped = (integer ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function alertNotificationText(view: AlertNotificationView): LineTextMessage {
  const heading = view.type === 'STOP_LOSS' ? '⚠️ 停損警示條件已觸發' : '🎯 停利警示條件已觸發';
  return { type: 'text', text: [
    heading, '', `${view.symbol} ${view.instrumentName}`,
    `目前價格：${displayDecimal(view.observedPrice)} ${view.currency}`,
    `${view.type === 'STOP_LOSS' ? '停損' : '停利'}價格：${displayDecimal(view.triggerPrice)} ${view.currency}`,
    `行情時間：${view.quoteAt.toISOString()}`, `資料來源：${view.source}`,
  ].join('\n') };
}
