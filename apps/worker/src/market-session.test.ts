import { describe, expect, it } from 'vitest';
import { MarketSessionPolicy, parseClosedMarketDates } from './market-session.js';

const twse = { market: 'TW', exchange: 'TWSE' };
const tpex = { market: 'TW', exchange: 'TPEx' };
const atTaipei = (local: string) => new Date(`${local}+08:00`);

describe('Taiwan market session policy', () => {
  it.each([
    ['2026-08-31T08:59:59', 'CLOSED'], ['2026-08-31T09:00:00', 'OPEN'],
    ['2026-08-31T12:00:00', 'OPEN'], ['2026-08-31T13:29:59', 'OPEN'],
    ['2026-08-31T13:30:00', 'CLOSED'], ['2026-08-31T13:31:00', 'CLOSED'],
  ])('classifies %s Asia/Taipei as %s', (time, status) => {
    expect(new MarketSessionPolicy().evaluate(twse, atTaipei(time)).status).toBe(status);
  });

  it('supports TWSE and TPEx using Asia/Taipei independent of machine timezone', () => {
    const instant = new Date('2026-08-31T01:00:00.000Z'); // 09:00 Asia/Taipei
    expect(new MarketSessionPolicy().evaluate(twse, instant)).toMatchObject({ status: 'OPEN', marketDate: '2026-08-31' });
    expect(new MarketSessionPolicy().evaluate(tpex, instant)).toMatchObject({ status: 'OPEN', marketDate: '2026-08-31' });
  });

  it('skips weekends, configured closed dates and unsupported markets explicitly', () => {
    const policy = new MarketSessionPolicy(new Set(['2026-08-31']));
    expect(policy.evaluate(twse, atTaipei('2026-08-29T10:00:00'))).toMatchObject({ status: 'CLOSED', reason: 'WEEKEND' });
    expect(policy.evaluate(twse, atTaipei('2026-08-31T10:00:00'))).toMatchObject({ status: 'CLOSED', reason: 'CONFIGURED_CLOSED_DATE' });
    expect(policy.evaluate({ market: 'US', exchange: 'NASDAQ' }, atTaipei('2026-08-31T10:00:00'))).toMatchObject({ status: 'UNSUPPORTED', reason: 'UNSUPPORTED_MARKET' });
  });

  it('parses explicit closed dates without inventing holidays', () => {
    expect([...parseClosedMarketDates('2026-01-01, 2026-02-16,2026-01-01')]).toEqual(['2026-01-01', '2026-02-16']);
    expect(() => parseClosedMarketDates('not-a-date')).toThrow('invalid date');
  });
});
