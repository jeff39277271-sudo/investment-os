import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRepository } from '@investment-os/db';
import { LineApplicationService, TransactionApplicationService } from '@investment-os/application';
import { LineMessagingApiClient, LineWebhookAdapter, verifyLineSignature } from './line.js';

export type LineWebhookEndpoint = { channelSecret: string; adapter: LineWebhookAdapter };
async function rawBody(request: IncomingMessage): Promise<Buffer> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); return Buffer.concat(chunks); }
export function createRequestHandler(endpoint: LineWebhookEndpoint) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'POST' || request.url !== '/webhooks/line') { response.writeHead(404).end(); return; }
    const body = await rawBody(request); const header = request.headers['x-line-signature']; const signature = Array.isArray(header) ? header[0] : header;
    if (!verifyLineSignature(body, signature, endpoint.channelSecret)) { response.writeHead(401).end('invalid LINE signature'); return; }
    try { await endpoint.adapter.handle(body); response.writeHead(200).end('ok'); } catch { response.writeHead(500).end('LINE webhook processing failed'); }
  };
}
export function createProductionServer(env: NodeJS.ProcessEnv = process.env) {
  const channelSecret = env.LINE_CHANNEL_SECRET; const accessToken = env.LINE_CHANNEL_ACCESS_TOKEN; const databaseUrl = env.DATABASE_URL;
  if (!channelSecret || !accessToken || !databaseUrl) throw new Error('LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN and DATABASE_URL are required');
  const repository = createRepository(databaseUrl);
  const adapter = new LineWebhookAdapter(new LineApplicationService(repository), new TransactionApplicationService(repository), new LineMessagingApiClient(accessToken));
  return createServer(createRequestHandler({ channelSecret, adapter }));
}
export * from './line.js';
