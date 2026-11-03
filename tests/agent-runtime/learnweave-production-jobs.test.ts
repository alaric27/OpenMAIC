import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
const mocks = vi.hoisted(() => ({ provider: vi.fn(), store: vi.fn(), owned: vi.fn() }));
vi.mock('@/extensions/learnweave/adapter', () => ({
  getServerPersistenceProvider: mocks.provider,
  assertOwnedWrite: mocks.owned,
}));
vi.mock('@openmaic/storage/pg-migrations', () => ({ applySchemaMigrations: vi.fn() }));
vi.mock('@/lib/server/agent-runtime/store', () => ({ getAgentSessionStore: mocks.store }));
vi.mock('@/lib/persistence/owner-merges', () => ({
  forwardOwnerWrite: async (_: unknown, owner: string) => owner,
}));
import {
  parseJobRequest,
  submitProductionJob,
  readProductionJob,
  recordProductionResult,
} from '@/extensions/learnweave/jobs';

it('rejects malformed keys and incomplete production contracts', () => {
  expect(() => parseJobRequest({ protocolVersion: 1, idempotencyKey: '-'.repeat(36) })).toThrow();
});
it('preserves published template identifiers and normalizes UUID keys', () => {
  const key = randomUUID();
  expect(
    parseJobRequest({
      protocolVersion: 1,
      idempotencyKey: key.toUpperCase(),
      prompt: 'One task',
      expected: { activityId: 'one', templateId: '英语.看图', templateRevision: 1 },
    }),
  ).toMatchObject({ idempotencyKey: key, expected: { templateId: '英语.看图' } });
});
const connection = process.env.STUDENT_MEMORY_TEST_DATABASE_URL;
describe.skipIf(!connection)('durable production job boundary', () => {
  let root: Pool, pool: Pool;
  const schema = `lw_jobs_${randomUUID().replaceAll('-', '')}`;
  const sessions = new Map<string, any>();
  let failAfterSessionCommit = false;
  const create = vi.fn(async (input: any) => {
    if (sessions.has(input.id)) throw Object.assign(Error('duplicate'), { code: '23505' });
    const session = { ...input, status: 'queued' };
    sessions.set(input.id, session);
    if (failAfterSessionCommit) {
      failAfterSessionCommit = false;
      throw Error('connection lost after commit');
    }
    return session;
  });
  beforeAll(async () => {
    root = new Pool({ connectionString: connection });
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(connection!);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new Pool({ connectionString: url.toString() });
    await pool.query(
      `CREATE TABLE learnweave_production_jobs(owner_id text,idempotency_key text,session_id text UNIQUE,fingerprint text,request jsonb,result jsonb,updated_at timestamptz,PRIMARY KEY(owner_id,idempotency_key))`,
    );
    mocks.provider.mockResolvedValue({
      pool,
      withTransaction: async (fn: any) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const result = await fn(c);
          await c.query('COMMIT');
          return result;
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        } finally {
          c.release();
        }
      },
    });
    mocks.store.mockResolvedValue({
      readRetirement: async () => null,
      getSession: async (id: string) => sessions.get(id) || null,
      createSession: create,
    });
  });
  beforeEach(() => {
    create.mockClear();
    mocks.owned.mockClear();
  });
  afterAll(async () => {
    await pool?.end();
    await root?.query(`DROP SCHEMA ${schema} CASCADE`);
    await root?.end();
  });
  const request = () =>
    parseJobRequest({
      protocolVersion: 1,
      idempotencyKey: randomUUID(),
      prompt: 'Produce one picture',
      expected: { activityId: 'one', templateId: 'picture', templateRevision: 2 },
    });
  it('concurrent submissions and response-loss retries create exactly one source session', async () => {
    const input = request();
    const [a, b] = await Promise.all([
      submitProductionJob('author', input, 'http://localhost'),
      submitProductionJob('author', input, 'http://localhost'),
    ]);
    expect(a.sessionId).toBe(b.sessionId);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM learnweave_production_jobs WHERE idempotency_key=$1',
          [input.idempotencyKey],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(sessions.size).toBe(1);
    const before = create.mock.calls.length;
    failAfterSessionCommit = true;
    const lost = request();
    await expect(submitProductionJob('author', lost, 'http://localhost')).rejects.toThrow(
      'connection lost',
    );
    const after = await submitProductionJob('author', lost, 'http://localhost');
    expect(after.status).toBe('running');
    expect(sessions.size).toBe(2);
    expect(create.mock.calls.length).toBe(before + 1);
  });
  it('rejects changed inputs and hides another author’s job', async () => {
    const input = request();
    await submitProductionJob('author', input, 'http://localhost');
    await expect(
      submitProductionJob('author', { ...input, prompt: 'different' }, 'http://localhost'),
    ).rejects.toMatchObject({ status: 409 });
    await expect(readProductionJob('other-author', input.idempotencyKey)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('completion requires a matching durable save result, independent of Agent events', async () => {
    const input = request(),
      job = await submitProductionJob('author', input, 'http://localhost');
    sessions.get(job.sessionId).status = 'succeeded';
    expect((await readProductionJob('author', input.idempotencyKey)).status).toBe('failed');
    const bundle = { source: { stageId: 'stage-one', bundleHash: 'a'.repeat(64) } } as any;
    const manifest = {
      activities: [{ id: 'one' }],
      templateSelections: { one: { id: 'wrong', revision: 2 } },
    };
    await expect(recordProductionResult('author', job.sessionId, bundle, manifest)).rejects.toThrow(
      '不一致',
    );
    manifest.templateSelections.one.id = 'picture';
    await recordProductionResult('author', job.sessionId, bundle, manifest);
    expect(await readProductionJob('author', input.idempotencyKey)).toMatchObject({
      status: 'succeeded',
      result: { stageId: 'stage-one', source: bundle.source },
    });
    expect(mocks.owned).toHaveBeenCalled();
  });
});
