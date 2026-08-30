import { pathToFileURL } from 'node:url';
import { AlertApplicationService, MarketDataApplicationService } from '@investment-os/application';
import { createRepositoryRuntime } from '@investment-os/db';
import { LineMessagingApiClient } from '@investment-os/line-ui';
import { createConfiguredMarketDataProvider, QuoteFreshnessPolicy } from '@investment-os/market-data';
import { AlertMonitoringWorker } from './index.js';

export type AlertWorkerConfig = {
  databaseUrl: string; environment: string; provider: string; fugleApiKey?: string;
  lineAccessToken: string; staleAfterMs: number;
};

function required(env: NodeJS.ProcessEnv, name: 'DATABASE_URL' | 'MARKET_DATA_PROVIDER' | 'LINE_CHANNEL_ACCESS_TOKEN'): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function readAlertWorkerConfig(env: NodeJS.ProcessEnv): AlertWorkerConfig {
  const staleAfterMs = Number(env.MARKET_DATA_STALE_AFTER_MS?.trim() || '300000');
  if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs <= 0) throw new Error('MARKET_DATA_STALE_AFTER_MS must be a positive integer');
  const fugleApiKey = env.FUGLE_API_KEY?.trim();
  return {
    databaseUrl: required(env, 'DATABASE_URL'), environment: env.NODE_ENV?.trim() || 'development',
    provider: required(env, 'MARKET_DATA_PROVIDER'), lineAccessToken: required(env, 'LINE_CHANNEL_ACCESS_TOKEN'),
    ...(fugleApiKey ? { fugleApiKey } : {}), staleAfterMs,
  };
}

export async function runConfiguredAlertWorker(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = readAlertWorkerConfig(env);
  const provider = createConfiguredMarketDataProvider({ environment: config.environment, provider: config.provider, apiKey: config.fugleApiKey });
  const line = new LineMessagingApiClient(config.lineAccessToken);
  const runtime = createRepositoryRuntime(config.databaseUrl);
  try {
    const policy = new QuoteFreshnessPolicy(config.staleAfterMs);
    const summary = await new AlertMonitoringWorker(
      runtime.repository,
      new MarketDataApplicationService(runtime.repository, policy),
      new AlertApplicationService(runtime.repository, policy),
      provider, line,
    ).runOnce();
    console.log(JSON.stringify(summary));
  } finally { await runtime.close(); }
}

async function main(): Promise<void> {
  try { await runConfiguredAlertWorker(); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Alert worker failed'); process.exitCode = 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
