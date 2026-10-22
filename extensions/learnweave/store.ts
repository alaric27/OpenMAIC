import { applySchemaMigrations } from '@openmaic/storage/pg-migrations';
import { LEARNWEAVE_MIGRATIONS } from './migrations';
import { getServerPersistenceProvider, assertOwnedWrite, type Queryable } from './adapter';
import type { TemplateManifest } from './contracts/generated';

export interface TemplateRow {
  revision: number;
  status: 'pending' | 'ready';
  manifest: TemplateManifest;
  fingerprint: string;
}
async function provider() {
  const p = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  await applySchemaMigrations(p.pool, LEARNWEAVE_MIGRATIONS);
  return p;
}
export async function readTemplates(stageId: string): Promise<TemplateRow | null> {
  const p = await provider();
  const r = await p.pool.query(
    'SELECT revision,status,manifest,fingerprint FROM learnweave_templates WHERE stage_id=$1',
    [stageId],
  );
  return r.rows[0] ?? null;
}
/** CAS plus an owner check inside the transaction; never accept an owner from tool parameters. */
export async function writeTemplates(
  stageId: string,
  ownerId: string,
  expectedRevision: number,
  manifest: TemplateManifest,
  status: 'pending' | 'ready',
  fingerprint: string,
  assertActive: () => void,
  fence?: (tx: Queryable) => Promise<void>,
) {
  const p = await provider();
  return p.withTransaction(async (tx) => {
    assertActive();
    await assertOwnedWrite(tx, ownerId, stageId, fence);
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`learnweave:${stageId}`]);
    const row = await tx.query(
      'SELECT revision FROM learnweave_templates WHERE stage_id=$1 FOR UPDATE',
      [stageId],
    );
    if ((row.rows[0]?.revision ?? 0) !== expectedRevision)
      throw new Error('Template revision changed; read and retry');
    const revision = expectedRevision + 1;
    const next = { ...manifest, revision };
    await tx.query(
      `INSERT INTO learnweave_templates(stage_id,revision,status,manifest,fingerprint) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(stage_id) DO UPDATE SET revision=$2,status=$3,manifest=$4,fingerprint=$5,updated_at=now()`,
      [stageId, revision, status, next, fingerprint],
    );
    assertActive();
    return next;
  });
}
