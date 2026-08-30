import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, InvestmentRepository } from '@investment-os/db';

const integration = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://investment:investment@localhost:5432/investment_os' });
const repository = new InvestmentRepository(createDb(pool));

integration('PostgreSQL scheduler lease', () => {
  beforeAll(async () => { await pool.query('select 1'); });
  beforeEach(async () => { await pool.query('TRUNCATE TABLE scheduler_leases'); });
  afterAll(async () => pool.end());

  it('atomically lets only one of two scheduler instances acquire the same job', async () => {
    const now = new Date('2026-08-31T01:00:00Z'); const job = `job-${randomUUID()}`;
    const results = await Promise.all([
      repository.acquireSchedulerLease(job, 'owner-a', now, new Date(now.getTime() + 60_000)),
      repository.acquireSchedulerLease(job, 'owner-b', now, new Date(now.getTime() + 60_000)),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('does not steal a valid lease, permits owner renewal, and permits crash recovery after expiry', async () => {
    const start = new Date('2026-08-31T01:00:00Z'); const job = `job-${randomUUID()}`;
    expect(await repository.acquireSchedulerLease(job, 'owner-a', start, new Date(start.getTime() + 10_000))).toBe(true);
    expect(await repository.acquireSchedulerLease(job, 'owner-b', new Date(start.getTime() + 5_000), new Date(start.getTime() + 15_000))).toBe(false);
    expect(await repository.renewSchedulerLease(job, 'owner-a', new Date(start.getTime() + 5_000), new Date(start.getTime() + 20_000))).toBe(true);
    expect(await repository.acquireSchedulerLease(job, 'owner-b', new Date(start.getTime() + 15_000), new Date(start.getTime() + 25_000))).toBe(false);
    expect(await repository.acquireSchedulerLease(job, 'owner-b', new Date(start.getTime() + 20_001), new Date(start.getTime() + 30_000))).toBe(true);
  });

  it('releases only the owning scheduler lease', async () => {
    const now = new Date('2026-08-31T01:00:00Z'); const job = `job-${randomUUID()}`;
    await repository.acquireSchedulerLease(job, 'owner-a', now, new Date(now.getTime() + 60_000));
    await repository.releaseSchedulerLease(job, 'owner-b', new Date(now.getTime() + 1_000));
    expect(await repository.acquireSchedulerLease(job, 'owner-b', new Date(now.getTime() + 2_000), new Date(now.getTime() + 60_000))).toBe(false);
    await repository.releaseSchedulerLease(job, 'owner-a', new Date(now.getTime() + 3_000));
    expect(await repository.acquireSchedulerLease(job, 'owner-b', new Date(now.getTime() + 3_001), new Date(now.getTime() + 60_000))).toBe(true);
  });
});
