/** OpenMAIC host APIs used by the source extension. */
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Queryable } from '@openmaic/storage/document/pg';
import type { CourseToolDeps } from '@/lib/server/agent-runtime/course-tools';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { assetPrincipalForOwner } from '@/lib/persistence/owner-assets';
import { fenceOwnerWrite } from '@/lib/persistence/owner-merges';

export { getServerPersistenceProvider };
export { assetPrincipalForOwner };
export { runStageMutation } from '@/lib/server/agent-runtime/mutation-fence';
export { withRequestOwner } from '@/lib/server/identity/with-owner';
export { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
export { probeStageAccess } from '@/lib/server/agent-runtime/curriculum-tools';
export { ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
export type { Queryable };
export type ToolDeps = CourseToolDeps & {
  sessionId: string;
  currentOwner: () => Promise<string>;
  fence: (tx: Queryable) => Promise<void>;
};

export async function wrapTools(tools: AgentTool[], deps: ToolDeps): Promise<AgentTool[]> {
  const { markDocumentWritersSequential, withOwnerStageAuthorization } =
    await import('@/lib/server/agent-runtime/course-tools');
  return markDocumentWritersSequential(
    withOwnerStageAuthorization(tools as unknown as AgentTool<never, never>[], deps),
  ) as AgentTool[];
}

/** Preserve owner-merge fencing, lease fencing and the owner row lock in one transaction. */
export async function assertOwnedWrite(
  tx: Queryable,
  ownerId: string,
  stageId: string,
  fence?: (tx: Queryable) => Promise<void>,
) {
  await fenceOwnerWrite(tx, ownerId, stageId);
  await fence?.(tx);
  const owned = await tx.query(
    'SELECT stage_id FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR SHARE',
    [stageId, ownerId],
  );
  if (!owned.rows.length) throw new Error('Course is no longer owned by this author');
}
