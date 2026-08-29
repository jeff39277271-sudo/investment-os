import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRepositoryRuntime } from '@investment-os/db';
import { LineApplicationService, TransactionApplicationService } from '@investment-os/application';
import { LineMessagingApiClient, LineWebhookAdapter, verifyLineSignature } from './line.js';

export type LineWebhookEndpoint = { channelSecret: string; adapter: LineWebhookAdapter };
export type ProductionApiServer = ReturnType<typeof createServer> & { closeResources: () => Promise<void> };
async function rawBody(request: IncomingMessage): Promise<Buffer> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); return Buffer.concat(chunks); }
export function createRequestHandler(endpoint: LineWebhookEndpoint) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (request.method !== 'POST' || request.url !== '/webhooks/line') { response.writeHead(404).end(); return; }
    const body = await rawBody(request); const header = request.headers['x-line-signature']; const signature = Array.isArray(header) ? header[0] : header;
    if (!verifyLineSignature(body, signature, endpoint.channelSecret)) { response.writeHead(401).end('invalid LINE signature'); return; }
    try { await endpoint.adapter.handle(body); response.writeHead(200).end('ok'); } catch { response.writeHead(500).end('LINE webhook processing failed'); }
  };
}

function requiredEnvironmentVariable(env: NodeJS.ProcessEnv, name: 'DATABASE_URL' | 'LINE_CHANNEL_SECRET' | 'LINE_CHANNEL_ACCESS_TOKEN'): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function createProductionServer(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = requiredEnvironmentVariable(env, 'DATABASE_URL');
  const channelSecret = requiredEnvironmentVariable(env, 'LINE_CHANNEL_SECRET');
  const accessToken = requiredEnvironmentVariable(env, 'LINE_CHANNEL_ACCESS_TOKEN');
  const runtime = createRepositoryRuntime(databaseUrl);
  const repository = runtime.repository;
  const adapter = new LineWebhookAdapter(new LineApplicationService(repository), new TransactionApplicationService(repository), new LineMessagingApiClient(accessToken));
  const server = createServer(createRequestHandler({ channelSecret, adapter })) as ProductionApiServer;
  server.closeResources = runtime.close;
  return server;
}
export * from './line.js';
