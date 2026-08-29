import { pathToFileURL } from 'node:url';
import { MarketDataApplicationService } from '@investment-os/application';
import { createRepositoryRuntime } from '@investment-os/db';
import { createConfiguredMarketDataProvider, QuoteFreshnessPolicy } from '@investment-os/market-data';

export type MarketRefreshConfig = {
  databaseUrl: string;
  environment: string;
  provider: string;
  apiKey?: string;
  staleAfterMs: number;
};

function required(env: NodeJS.ProcessEnv, name: 'DATABASE_URL' | 'MARKET_DATA_PROVIDER'): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function readMarketRefreshConfig(env: NodeJS.ProcessEnv): MarketRefreshConfig {
  const rawStaleAfterMs = env.MARKET_DATA_STALE_AFTER_MS?.trim() || '300000';
  const staleAfterMs = Number(rawStaleAfterMs);
  if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs <= 0) throw new Error('MARKET_DATA_STALE_AFTER_MS must be a positive integer');
  const apiKey = env.FUGLE_API_KEY?.trim();
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    environment: env.NODE_ENV?.trim() || 'development',
    provider: required(env, 'MARKET_DATA_PROVIDER'),
    ...(apiKey ? { apiKey } : {}),
    staleAfterMs,
  };
}

export async function refreshMarketQuote(symbol: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) throw new Error('Usage: pnpm market:refresh <symbol>');
  const config = readMarketRefreshConfig(env);
  const runtime = createRepositoryRuntime(config.databaseUrl);
  try {
    const instrument = await runtime.repository.findInstrumentBySymbol(normalizedSymbol);
    if (!instrument) throw new Error(`Instrument not found: ${normalizedSymbol}. Run pnpm db:seed:dev for development symbols.`);
    const provider = createConfiguredMarketDataProvider({
      environment: config.environment,
      provider: config.provider,
      apiKey: config.apiKey,
    });
    const policy = new QuoteFreshnessPolicy(config.staleAfterMs);
    const service = new MarketDataApplicationService(runtime.repository, policy);
    const stored = await service.refreshQuote(instrument.id, provider);
    const freshness = policy.classify(instrument.id, {
      quoteAt: stored.quoteAt,
      receivedAt: stored.receivedAt,
      source: stored.source,
    }, new Date());
    console.log(JSON.stringify({
      symbol: instrument.symbol,
      price: stored.price,
      currency: stored.currency,
      quoteAt: stored.quoteAt.toISOString(),
      receivedAt: stored.receivedAt.toISOString(),
      source: stored.source,
      freshness: freshness.status,
    }));
  } finally {
    await runtime.close();
  }
}

async function main(): Promise<void> {
  try { await refreshMarketQuote(process.argv[2] ?? ''); }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Market quote refresh failed');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
