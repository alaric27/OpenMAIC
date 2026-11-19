import { createHash, randomUUID } from 'node:crypto';
import type { ProductionBundle } from './transport-types';
import { ProductionError } from './client';
import { getServerPersistenceProvider, assertOwnedWrite, type Queryable } from './adapter';
import { applySchemaMigrations } from '@openmaic/storage/pg-migrations';
import { LEARNWEAVE_COURSE_MIGRATIONS } from './migrations';
import { getAgentSessionStore } from '@/lib/server/agent-runtime/store';
import { forwardOwnerWrite } from '@/lib/persistence/owner-merges';

export interface ProductionJobRequest {
  protocolVersion: 1;
  idempotencyKey: string;
  prompt: string;
  expected: { activityId: string; templateId: string; templateRevision: number };
}
export function parseJobRequest(raw: unknown): ProductionJobRequest {
  const b = raw as ProductionJobRequest;
  if (
    !b ||
    b.protocolVersion !== 1 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      b.idempotencyKey || '',
    ) ||
    typeof b.prompt !== 'string' ||
    !b.prompt.trim() ||
    Buffer.byteLength(b.prompt) > 100000 ||
    !b.expected ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(b.expected.activityId || '') ||
    typeof b.expected.templateId !== 'string' ||
    !b.expected.templateId.trim() ||
    b.expected.templateId.length > 128 ||
    !Number.isInteger(b.expected.templateRevision) ||
    b.expected.templateRevision < 1
  )
    throw new ProductionError('生产请求格式无效', 400);
  return {
    protocolVersion: 1,
    idempotencyKey: b.idempotencyKey.toLowerCase(),
    prompt: b.prompt,
    expected: {
      activityId: b.expected.activityId,
      templateId: b.expected.templateId,
      templateRevision: b.expected.templateRevision,
    },
  };
}
async function provider() {
  const p = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  await applySchemaMigrations(p.pool, LEARNWEAVE_COURSE_MIGRATIONS);
  return p;
}

/** Reserve a session ID durably BEFORE creation. A crash or concurrent retry uses the same ID. */
export async function submitProductionJob(
  ownerId: string,
  request: ProductionJobRequest,
  origin: string,
) {
  const p = await provider();
  const store = await getAgentSessionStore();
  if (await store.readRetirement(ownerId))
    throw new ProductionError('作者身份已变化，请重新授权', 409);
  const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const row: any = await p.withTransaction(async (tx) => {
    const finalOwner = await forwardOwnerWrite(tx, ownerId);
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `lw-production:${finalOwner}:${request.idempotencyKey}`,
    ]);
    const old = await tx.query(
      'SELECT * FROM learnweave_production_jobs WHERE owner_id=$1 AND idempotency_key=$2',
      [finalOwner, request.idempotencyKey],
    );
    if (old.rows[0]) {
      if (old.rows[0].fingerprint !== fingerprint)
        throw new ProductionError('幂等键已用于不同生产要求', 409);
      return old.rows[0];
    }
    const inserted = await tx.query(
      'INSERT INTO learnweave_production_jobs(owner_id,idempotency_key,session_id,fingerprint,request) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [finalOwner, request.idempotencyKey, randomUUID(), fingerprint, request],
    );
    return inserted.rows[0]!;
  });
  let session = await store.getSession(row.session_id);
  if (!session) {
    try {
      session = await store.createSession({
        id: row.session_id,
        ownerId: row.owner_id,
        prompt: request.prompt,
        skillId: 'learnweave-english',
        origin,
      });
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error;
      session = await store.getSession(row.session_id);
    }
  }
  if (!session || session.ownerId !== row.owner_id || session.prompt !== request.prompt)
    throw new ProductionError('生产会话归属或输入不一致', 409);
  return readProductionJob(row.owner_id, request.idempotencyKey);
}

export async function readProductionJob(ownerId: string, key: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))
    throw new ProductionError('生产任务不存在', 404);
  const p = await provider();
  const row = (
    await p.pool.query(
      'SELECT * FROM learnweave_production_jobs WHERE owner_id=$1 AND idempotency_key=$2',
      [ownerId, key.toLowerCase()],
    )
  ).rows[0];
  if (!row) throw new ProductionError('生产任务不存在', 404);
  const session = await (await getAgentSessionStore()).getSession(row.session_id);
  if (session && session.ownerId !== ownerId) throw new ProductionError('生产任务不存在', 404);
  const settled = session?.status === 'succeeded';
  return {
    protocolVersion: 1,
    id: key.toLowerCase(),
    sessionId: row.session_id,
    status: !session
      ? 'queued'
      : settled
        ? row.result
          ? 'succeeded'
          : 'failed'
        : ['failed', 'cancelled'].includes(session.status)
          ? 'failed'
          : 'running',
    ...(settled && row.result ? { result: row.result } : {}),
    ...(settled && !row.result ? { error: 'Agent 已结束，但没有通过导出检查的生产产物' } : {}),
  };
}

/** Called by the save tool; no consumer needs to inspect Agent event formats. */
export async function recordProductionResult(
  ownerId: string,
  sessionId: string,
  bundle: ProductionBundle,
  manifest: Record<string, any>,
  fence?: (tx: Queryable) => Promise<void>,
) {
  const p = await provider();
  await p.withTransaction(async (tx) => {
    await assertOwnedWrite(tx, ownerId, bundle.source.stageId, fence);
    const row = (
      await tx.query(
        'SELECT request FROM learnweave_production_jobs WHERE owner_id=$1 AND session_id=$2 FOR UPDATE',
        [ownerId, sessionId],
      )
    ).rows[0];
    if (!row) return; // Ordinary workbench sessions are not production jobs.
    const expected = (row.request as ProductionJobRequest).expected;
    const selection = manifest.templateSelections?.[expected.activityId];
    if (
      manifest.activities?.length !== 1 ||
      manifest.activities[0].id !== expected.activityId ||
      selection?.id !== expected.templateId ||
      selection?.revision !== expected.templateRevision
    )
      throw new ProductionError('保存内容与生产任务要求不一致', 409);
    await tx.query(
      'UPDATE learnweave_production_jobs SET result=$3,updated_at=now() WHERE owner_id=$1 AND session_id=$2',
      [ownerId, sessionId, { stageId: bundle.source.stageId, source: bundle.source }],
    );
  });
}

export async function cancelProductionJob(ownerId: string, key: string) {
  const job = await readProductionJob(ownerId, key);
  if (['queued', 'running'].includes(job.status))
    await (await getAgentSessionStore()).requestCancel(job.sessionId);
  return job;
}

/** Resume an unsuccessful producer in the SAME session. The message marker is durable
 * in the session store, so a lost HTTP response cannot enqueue the retry twice. */
export async function retryProductionJob(ownerId: string, key: string, retryId: string) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(key) || !uuid.test(retryId)) throw new ProductionError('生产重试身份无效', 400);
  key = key.toLowerCase(); retryId = retryId.toLowerCase();
  const p = await provider();
  const store = await getAgentSessionStore();
  if (await store.readRetirement(ownerId)) throw new ProductionError('作者身份已变化，请重新授权', 409);
  await p.withTransaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`lw-production:${ownerId}:${key}`]);
    const row = (await tx.query('SELECT * FROM learnweave_production_jobs WHERE owner_id=$1 AND idempotency_key=$2', [ownerId, key])).rows[0];
    if (!row) throw new ProductionError('生产任务不存在', 404);
    const sessionId = String(row.session_id);
    const session = await store.getSession(sessionId);
    if (!session || session.ownerId !== ownerId) throw new ProductionError('生产任务不存在', 404);
    if (row.result) return;
    const marker = `[learnweave-production-retry:${retryId}]`;
    const messages = await store.listUserMessages(sessionId);
    if (messages.some(m => m.text.startsWith(marker))) return;
    if (!['succeeded', 'failed', 'cancelled'].includes(session.status)) return;
    await store.postUserMessage(sessionId, {
      text: `${marker}\n继续完成原来的单任务生产请求。上次未得到可导出的有效产物；请核对工具错误并重试失败步骤，复用本会话已保存的容器和成功素材，不重做已完成部分。保持原模板修订、activityId、材料角色、任务配置和评分绑定不变，不询问用户或放宽验证。图片服务临时失败时可以重试相同教学要求的图片。最终必须通过 lw_save_course 并得到 exportReady=true；不要只声称完成。`,
    }, { expectedOwnerId: ownerId });
  });
  return readProductionJob(ownerId, key);
}
