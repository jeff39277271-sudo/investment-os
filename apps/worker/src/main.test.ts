import { describe, expect, it } from 'vitest';
import { readAlertWorkerConfig } from './main.js';

describe('alert worker configuration', () => {
  it('loads explicit provider and required LINE configuration', () => {
    expect(readAlertWorkerConfig({ DATABASE_URL: 'postgres://test', MARKET_DATA_PROVIDER: 'fake', LINE_CHANNEL_ACCESS_TOKEN: 'token' })).toEqual({
      databaseUrl: 'postgres://test', environment: 'development', provider: 'fake', lineAccessToken: 'token', staleAfterMs: 300000,
    });
  });
  it('fails fast without required configuration', () => {
    expect(() => readAlertWorkerConfig({})).toThrow('DATABASE_URL');
    expect(() => readAlertWorkerConfig({ DATABASE_URL: 'db' })).toThrow('MARKET_DATA_PROVIDER');
    expect(() => readAlertWorkerConfig({ DATABASE_URL: 'db', MARKET_DATA_PROVIDER: 'fake' })).toThrow('LINE_CHANNEL_ACCESS_TOKEN');
  });
});
