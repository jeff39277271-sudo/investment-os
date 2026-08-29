import { describe, expect, it } from 'vitest';
import { readMarketRefreshConfig } from './market-refresh.js';

describe('market refresh runtime configuration', () => {
  it('uses an explicit provider and defaults freshness to five minutes', () => {
    expect(readMarketRefreshConfig({ DATABASE_URL: 'postgres://test', MARKET_DATA_PROVIDER: 'fake' })).toEqual({
      databaseUrl: 'postgres://test', environment: 'development', provider: 'fake', staleAfterMs: 300000,
    });
  });

  it('supports production Fugle configuration without exposing the key in errors', () => {
    expect(readMarketRefreshConfig({ DATABASE_URL: 'postgres://test', NODE_ENV: 'production', MARKET_DATA_PROVIDER: 'fugle', FUGLE_API_KEY: 'secret', MARKET_DATA_STALE_AFTER_MS: '60000' })).toEqual({
      databaseUrl: 'postgres://test', environment: 'production', provider: 'fugle', apiKey: 'secret', staleAfterMs: 60000,
    });
  });

  it('fails on missing required configuration and invalid freshness', () => {
    expect(() => readMarketRefreshConfig({ MARKET_DATA_PROVIDER: 'fake' })).toThrow('DATABASE_URL');
    expect(() => readMarketRefreshConfig({ DATABASE_URL: 'postgres://test' })).toThrow('MARKET_DATA_PROVIDER');
    expect(() => readMarketRefreshConfig({ DATABASE_URL: 'postgres://test', MARKET_DATA_PROVIDER: 'fake', MARKET_DATA_STALE_AFTER_MS: '0' })).toThrow('positive integer');
  });
});
