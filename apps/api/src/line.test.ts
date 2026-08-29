import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import type { LineApplicationService, TransactionApplicationService } from '@investment-os/application';
import { transactionConfirmationFlex } from '@investment-os/line-ui';
import { createProductionServer, createRequestHandler, FakeLineMessagingClient, LineMessagingApiClient, LineWebhookAdapter, parseTransactionCommand, verifyLineSignature } from './index.js';

describe('LINE adapter primitives', () => {
  async function withEndpoint(run: (baseUrl: string, adapter: LineWebhookAdapter) => Promise<void>) {
    const adapter = new LineWebhookAdapter(undefined as unknown as LineApplicationService, undefined as unknown as TransactionApplicationService, new FakeLineMessagingClient());
    vi.spyOn(adapter, 'handle').mockResolvedValue();
    const server = createServer(createRequestHandler({ channelSecret: 'secret', adapter }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, adapter); }
    finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  }

  it('accepts a valid LINE signature computed from the unchanged raw body', () => {
    const raw = Buffer.from('{"events":[]}');
    const signature = createHmac('sha256', 'secret').update(raw).digest('base64');
    expect(verifyLineSignature(raw, signature, 'secret')).toBe(true);
    expect(verifyLineSignature(Buffer.from('{ "events": [] }'), signature, 'secret')).toBe(false);
  });

  it('rejects missing and invalid LINE signatures', () => {
    expect(verifyLineSignature(Buffer.from('body'), undefined, 'secret')).toBe(false);
    expect(verifyLineSignature(Buffer.from('body'), 'invalid', 'secret')).toBe(false);
  });

  it('rejects an invalid signature at the endpoint before invoking the adapter', async () => {
    await withEndpoint(async (baseUrl, adapter) => {
      const invalid = await fetch(`${baseUrl}/webhooks/line`, { method: 'POST', headers: { 'x-line-signature': 'invalid' }, body: '{"events":[]}' });
      expect(invalid.status).toBe(401); expect(adapter.handle).not.toHaveBeenCalled();
      const raw = '{"events":[]}'; const signature = createHmac('sha256', 'secret').update(raw).digest('base64');
      const valid = await fetch(`${baseUrl}/webhooks/line`, { method: 'POST', headers: { 'x-line-signature': signature }, body: raw });
      expect(valid.status).toBe(200); expect(adapter.handle).toHaveBeenCalledOnce();
    });
  });

  it('serves health without LINE authentication and returns 404 for unknown routes', async () => {
    await withEndpoint(async (baseUrl, adapter) => {
      const health = await fetch(`${baseUrl}/health`);
      expect(health.status).toBe(200); expect(await health.json()).toEqual({ status: 'ok' });
      expect(health.headers.get('content-type')).toContain('application/json');
      const unknown = await fetch(`${baseUrl}/unknown`);
      expect(unknown.status).toBe(404); expect(adapter.handle).not.toHaveBeenCalled();
      const quoteRoute = await fetch(`${baseUrl}/api/quotes/2330`);
      expect(quoteRoute.status).toBe(404);
    });
  });

  it('fails production server creation on the first missing required environment variable', () => {
    expect(() => createProductionServer({})).toThrow('Missing required environment variable: DATABASE_URL');
    expect(() => createProductionServer({ DATABASE_URL: 'postgres://unused' })).toThrow('Missing required environment variable: LINE_CHANNEL_SECRET');
    expect(() => createProductionServer({ DATABASE_URL: 'postgres://unused', LINE_CHANNEL_SECRET: 'secret' })).toThrow('Missing required environment variable: LINE_CHANNEL_ACCESS_TOKEN');
  });

  it('parses only deterministic BUY, SELL, 買 and 賣 commands', () => {
    expect(parseTransactionCommand('BUY 2330 100 1250')).toEqual({ side: 'BUY', symbol: '2330', quantity: '100', price: '1250' });
    expect(parseTransactionCommand('賣 2330 50 1300')).toEqual({ side: 'SELL', symbol: '2330', quantity: '50', price: '1300' });
    expect(parseTransactionCommand('I might buy 2330')).toBeUndefined();
    expect(parseTransactionCommand('BUY 2330 -1 1250')).toBeUndefined();
  });

  it('builds a Flex confirmation with server-side draft postbacks and Decimal-safe total', () => {
    const message = transactionConfirmationFlex({ draftId: 'draft-1', symbol: '2330', instrumentName: '台積電', side: 'BUY', quantity: '100', price: '1250', currency: 'TWD', fee: '0', tax: '0' });
    expect(message.type).toBe('flex');
    expect(JSON.stringify(message)).toContain('action=confirm&draftId=draft-1');
    expect(JSON.stringify(message)).toContain('TWD 125,000');
  });

  it('uses the LINE reply API abstraction without exposing it to application/domain', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    await new LineMessagingApiClient('token', fetcher).reply('reply-token', [{ type: 'text', text: 'ok' }]);
    expect(fetcher).toHaveBeenCalledWith('https://api.line.me/v2/bot/message/reply', expect.objectContaining({ method: 'POST' }));
  });
});
