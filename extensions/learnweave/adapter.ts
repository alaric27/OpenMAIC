/** OpenMAIC host boundary. Keep private host API changes here, outside template logic.
 * TTS has its own optional adapter (media.ts), loaded only for a missing prompt audio.
 */
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Queryable } from '@openmaic/storage/document/pg';
import type { CourseToolDeps } from '@/lib/server/agent-runtime/course-tools';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { assetPrincipalForOwner } from '@/lib/persistence/owner-assets';
import { ActivityInputError } from './errors';
import { fenceOwnerWrite } from '@/lib/persistence/owner-merges';

export { getServerPersistenceProvider };
export { runStageMutation } from '@/lib/server/agent-runtime/mutation-fence';
export { withRequestOwner } from '@/lib/server/identity/with-owner';
export { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
export { probeStageAccess } from '@/lib/server/agent-runtime/curriculum-tools';
export { ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
export type { CourseDocument } from '@/lib/server/agent-runtime/course-tools';
export type { Queryable };
export type ToolDeps = CourseToolDeps & {
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

export async function assertOwnedAssets(
  ownerId: string,
  assets: { id: string; kind: string; field?: string }[],
) {
  if (!assets.length) return;
  const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  for (const asset of assets) {
    const meta = await provider.assetStore.identify(assetPrincipalForOwner(ownerId), asset.id);
    if (!meta)
      throw new ActivityInputError(
        'ASSET_NOT_OWNED',
        `Referenced media ${asset.id} must be an owned saved asset.`,
        asset.field,
      );
    if (!meta.mime.startsWith(asset.kind + '/'))
      throw new ActivityInputError(
        'ASSET_TYPE_MISMATCH',
        `Referenced media ${asset.id}: expected type ${asset.kind}/*, received ${meta.mime}. Never use an image asset as audio. For listening TTS, omit audioSrc and supply promptText.`,
        asset.field,
      );
  }
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

export async function promptAudio(
  text: string,
  stageId: string,
  ownerId: string,
  signal: AbortSignal | undefined,
  fence: (tx: Queryable) => Promise<void>,
) {
  const media = await import('./media');
  return media.promptAudio(text, stageId, ownerId, signal, fence);
}
