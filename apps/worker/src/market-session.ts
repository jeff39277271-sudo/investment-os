import type { InstrumentRecord } from '@investment-os/db';

export type MarketSessionResult =
  | { status: 'OPEN'; marketDate: string }
  | { status: 'CLOSED'; reason: 'WEEKEND' | 'CONFIGURED_CLOSED_DATE' | 'OUTSIDE_REGULAR_SESSION'; marketDate: string }
  | { status: 'UNSUPPORTED'; reason: 'UNSUPPORTED_MARKET'; marketDate: string };

type MarketInstrument = Pick<InstrumentRecord, 'market' | 'exchange'>;

function taipeiParts(now: Date): { date: string; weekday: string; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`, weekday: get('weekday'),
    hour: Number(get('hour')), minute: Number(get('minute')), second: Number(get('second')),
  };
}

export function parseClosedMarketDates(value: string | undefined): ReadonlySet<string> {
  const dates = new Set<string>();
  for (const raw of value?.split(',') ?? []) {
    const date = raw.trim();
    if (!date) continue;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error(`TW_MARKET_CLOSED_DATES contains invalid date: ${date}`);
    dates.add(date);
  }
  return dates;
}

export class MarketSessionPolicy {
  readonly timeZone = 'Asia/Taipei';
  constructor(private readonly closedDates: ReadonlySet<string> = new Set()) {}

  evaluate(instrument: MarketInstrument, now: Date): MarketSessionResult {
    if (Number.isNaN(now.getTime())) throw new Error('market session clock returned an invalid date');
    const local = taipeiParts(now);
    if (instrument.market !== 'TW' || !['TWSE', 'TPEx'].includes(instrument.exchange)) return { status: 'UNSUPPORTED', reason: 'UNSUPPORTED_MARKET', marketDate: local.date };
    if (local.weekday === 'Sat' || local.weekday === 'Sun') return { status: 'CLOSED', reason: 'WEEKEND', marketDate: local.date };
    if (this.closedDates.has(local.date)) return { status: 'CLOSED', reason: 'CONFIGURED_CLOSED_DATE', marketDate: local.date };
    const seconds = local.hour * 3600 + local.minute * 60 + local.second;
    return seconds >= 9 * 3600 && seconds < 13 * 3600 + 30 * 60
      ? { status: 'OPEN', marketDate: local.date }
      : { status: 'CLOSED', reason: 'OUTSIDE_REGULAR_SESSION', marketDate: local.date };
  }
}
