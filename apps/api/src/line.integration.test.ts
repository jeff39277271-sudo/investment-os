import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, InvestmentRepository } from '@investment-os/db';
import { LineApplicationService, TransactionApplicationService } from '@investment-os/application';
import { FakeLineMessagingClient, LineWebhookAdapter } from './line.js';

const integration = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://investment:investment@localhost:5432/investment_os' });
const repository = new InvestmentRepository(createDb(pool));
let now = new Date('2026-08-29T01:00:00.000Z');
let messaging: FakeLineMessagingClient;
let adapter: LineWebhookAdapter;

function event(eventId: string, userId: string, text: string) {
  return Buffer.from(JSON.stringify({ events: [{ type: 'message', webhookEventId: eventId, replyToken: `reply-${eventId}`, source: { type: 'user', userId }, message: { type: 'text', text } }] }));
}
function postback(eventId: string, userId: string, action: string, draftId: string) {
  return Buffer.from(JSON.stringify({ events: [{ type: 'postback', webhookEventId: eventId, replyToken: `reply-${eventId}`, source: { type: 'user', userId }, postback: { data: `action=${action}&draftId=${draftId}` } }] }));
}
async function count(table: string) { const result = await pool.query(`select count(*)::int as count from ${table}`); return result.rows[0].count as number; }
async function draftId() { const result = await pool.query('select id from transaction_drafts order by created_at desc limit 1'); return result.rows[0].id as string; }

integration('LINE PostgreSQL integration', () => {
  beforeAll(async () => { await pool.query('select 1'); });
  beforeEach(async () => {
    now = new Date('2026-08-29T01:00:00.000Z');
    await pool.query('TRUNCATE TABLE line_webhook_events, instrument_quotes, transactions, transaction_drafts, position_snapshots, instruments, portfolios, user_identities, users CASCADE');
    await repository.createInstrument({ symbol: '2330', name: '台積電', exchange: 'TWSE', market: 'TW', currency: 'TWD', assetType: 'EQUITY', providerSymbol: 'TWSE:2330' });
    messaging = new FakeLineMessagingClient();
    adapter = new LineWebhookAdapter(new LineApplicationService(repository), new TransactionApplicationService(repository, () => now), messaging, () => now);
  });
  afterAll(async () => pool.end());

  it('creates a first LINE user mapping and reuses the existing identity', async () => {
    await adapter.handle(event('identity-1', 'U-ONE', 'help'));
    await adapter.handle(event('identity-2', 'U-ONE', 'help'));
    expect(await count('users')).toBe(1); expect(await count('user_identities')).toBe(1); expect(await count('portfolios')).toBe(1);
  });

  it('BUY and SELL commands create drafts only and return Flex confirmations', async () => {
    await adapter.handle(event('buy-1', 'U-ONE', 'BUY 2330 100 1250'));
    await adapter.handle(event('sell-1', 'U-ONE', 'SELL 2330 50 1300'));
    expect(await count('transaction_drafts')).toBe(2); expect(await count('transactions')).toBe(0);
    expect(messaging.replies.every((reply) => reply.messages[0].type === 'flex')).toBe(true);
  });

  it('confirmation creates exactly one transaction and webhook retry is deduplicated', async () => {
    await adapter.handle(event('buy-1', 'U-ONE', 'BUY 2330 100 1250')); const id = await draftId();
    const confirmation = postback('confirm-1', 'U-ONE', 'confirm', id);
    await adapter.handle(confirmation); await adapter.handle(confirmation);
    expect(await count('transactions')).toBe(1); expect(await count('line_webhook_events')).toBe(2);
  });

  it('cancel calls the draft workflow and prevents confirmation', async () => {
    await adapter.handle(event('buy-1', 'U-ONE', 'BUY 2330 100 1250')); const id = await draftId();
    await adapter.handle(postback('cancel-1', 'U-ONE', 'cancel', id));
    await expect(adapter.handle(postback('confirm-1', 'U-ONE', 'confirm', id))).rejects.toThrow('CANCELLED');
    expect(await count('transactions')).toBe(0);
  });

  it('rejects expired drafts', async () => {
    await adapter.handle(event('buy-1', 'U-ONE', 'BUY 2330 100 1250')); const id = await draftId(); now = new Date(now.getTime() + 16 * 60 * 1000);
    await expect(adapter.handle(postback('confirm-expired', 'U-ONE', 'confirm', id))).rejects.toThrow('expired');
    expect(await count('transactions')).toBe(0);
  });

  it('prevents user A from confirming user B draft', async () => {
    await adapter.handle(event('buy-a', 'U-A', 'BUY 2330 100 1250')); const id = await draftId();
    await expect(adapter.handle(postback('confirm-b', 'U-B', 'confirm', id))).rejects.toThrow('does not belong');
    expect(await count('transactions')).toBe(0);
  });

  it('deduplicates a repeated command event and malformed commands create no drafts or transactions', async () => {
    const command = event('same-buy', 'U-ONE', 'BUY 2330 100 1250'); await adapter.handle(command); await adapter.handle(command);
    await adapter.handle(event('malformed', 'U-ONE', 'BUY maybe someday'));
    expect(await count('transaction_drafts')).toBe(1); expect(await count('transactions')).toBe(0);
  });
});
