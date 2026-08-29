import { Decimal } from 'decimal.js';

export type LineTextMessage = { type: 'text'; text: string };
export type LineFlexMessage = { type: 'flex'; altText: string; contents: Record<string, unknown> };
export type LineMessage = LineTextMessage | LineFlexMessage;
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
