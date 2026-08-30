import { describe, expect, it, vi } from 'vitest';
import { alertNotificationText, FakeLineMessagingClient, LineMessagingApiClient, LineMessagingError } from './index.js';

describe('LINE proactive messaging', () => {
  it('uses the official push endpoint, bearer authentication, body and durable retry key', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    await new LineMessagingApiClient('local-test-token', fetcher).push('U123', [{ type: 'text', text: 'test' }], '00000000-0000-0000-0000-000000000001');
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.line.me/v2/bot/message/push');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer local-test-token', 'x-line-retry-key': '00000000-0000-0000-0000-000000000001' }),
      body: JSON.stringify({ to: 'U123', messages: [{ type: 'text', text: 'test' }] }),
    });
  });

  it.each([[429, 'RATE_LIMITED', true], [500, 'PROVIDER_UNAVAILABLE', true], [503, 'PROVIDER_UNAVAILABLE', true], [400, 'INVALID_REQUEST', false], [401, 'AUTH_ERROR', false]])(
    'classifies HTTP %s as %s retryable=%s', async (status, code, retryable) => {
      const client = new LineMessagingApiClient('token', (async () => new Response('{}', { status })) as typeof fetch);
      await expect(client.push('U1', [{ type: 'text', text: 'x' }], 'retry-id')).rejects.toMatchObject({ code, retryable });
    },
  );

  it('treats LINE retry-key conflict as already accepted', async () => {
    const client = new LineMessagingApiClient('token', (async () => new Response('{}', { status: 409 })) as typeof fetch);
    await expect(client.push('U1', [{ type: 'text', text: 'x' }], 'retry-id')).resolves.toBeUndefined();
  });

  it('classifies timeout and network errors without leaking the token', async () => {
    const timeout = new LineMessagingApiClient('do-not-log-token', (() => new Promise<Response>(() => {})) as typeof fetch, 5);
    const network = new LineMessagingApiClient('do-not-log-token', (async () => { throw new Error('do-not-log-token'); }) as typeof fetch);
    await expect(timeout.push('U1', [], 'retry-id')).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
    await expect(network.push('U1', [], 'retry-id')).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
    try { await network.push('U1', [], 'retry-id'); } catch (error) { expect(String(error)).not.toContain('do-not-log-token'); }
  });

  it('records deterministic fake pushes', async () => {
    const fake = new FakeLineMessagingClient(); await fake.push('U1', [{ type: 'text', text: 'x' }], 'retry-id');
    expect(fake.pushes).toEqual([{ lineUserId: 'U1', messages: [{ type: 'text', text: 'x' }], retryKey: 'retry-id' }]);
  });

  it('formats factual stop-loss and take-profit messages with preserved values and source', () => {
    const base = { symbol: '2330', instrumentName: '台積電', observedPrice: '1190.000000000001', triggerPrice: '1200', currency: 'TWD', quoteAt: new Date('2026-08-29T02:00:00Z'), source: 'FUGLE' };
    const stop = alertNotificationText({ ...base, type: 'STOP_LOSS' }).text;
    const profit = alertNotificationText({ ...base, type: 'TAKE_PROFIT' }).text;
    expect(stop).toContain('停損警示條件已觸發'); expect(stop).toContain('1,190.000000000001 TWD'); expect(stop).toContain('停損價格：1,200 TWD');
    expect(stop).toContain('2026-08-29T02:00:00.000Z'); expect(stop).toContain('資料來源：FUGLE');
    expect(profit).toContain('停利警示條件已觸發'); expect(profit).not.toMatch(/建議|應該|適合出場/);
  });

  it('requires a channel token without including it in errors', () => {
    expect(() => new LineMessagingApiClient('')).toThrow(LineMessagingError);
  });
});
