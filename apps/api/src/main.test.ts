import { describe, expect, it } from 'vitest';
import { readRuntimeConfig } from './main.js';

describe('API runtime configuration', () => {
  it('defaults PORT to 3000 and listens on all local interfaces', () => {
    expect(readRuntimeConfig({})).toEqual({ host: '0.0.0.0', port: 3000 });
  });

  it('supports a valid PORT override', () => {
    expect(readRuntimeConfig({ PORT: '4312' })).toEqual({ host: '0.0.0.0', port: 4312 });
  });

  it('rejects invalid PORT values', () => {
    for (const port of ['0', '65536', '3.14', 'abc']) expect(() => readRuntimeConfig({ PORT: port })).toThrow('PORT must be an integer');
  });
});
