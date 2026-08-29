import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // PostgreSQL integration suites share the configured local database.
    fileParallelism: false,
  },
});
