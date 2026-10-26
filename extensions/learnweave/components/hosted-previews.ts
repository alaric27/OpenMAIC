import { randomBytes } from 'node:crypto';
import {
  productionSpec,
  ProductionError,
  createComponentPreview,
  componentPreviewThumbnail,
} from '../client';
import { definitionFor } from './definitions';
import { componentAssets } from './protocol';
import { getServerPersistenceProvider, assetPrincipalForOwner } from '../adapter';
type Grant = {
  ownerId: string;
  expires: number;
  assets: Map<string, { revision: string; mimeType: string }>;
};
type Hosted = { ownerId: string; expires: number; id: string; token: string };
const state = globalThis as typeof globalThis & {
  __learnweavePreviewGrants?: Map<string, Grant>;
  __learnweaveHostedPreviews?: Map<string, Hosted>;
};
const grants = (state.__learnweavePreviewGrants ??= new Map<string, Grant>());
const hosted = (state.__learnweaveHostedPreviews ??= new Map<string, Hosted>());
function prune() {
  for (const map of [grants, hosted])
    for (const [id, s] of map) if (s.expires < Date.now()) map.delete(id);
}
export async function hostedPreview(ownerId: string, parentOrigin: string, input: any) {
  prune();
  if (grants.size >= 200) throw new ProductionError('临时预览数量已达上限，请稍后重试');
  if (
    !input?.content ||
    input.content.type !== 'component' ||
    !['view', 'edit', 'thumbnail'].includes(input.mode) ||
    !input.content.props ||
    typeof input.content.props !== 'object' ||
    Array.isArray(input.content.props) ||
    JSON.stringify(input.content.props).length > 100000
  )
    throw new ProductionError('组件预览输入无效');
  const definition = definitionFor(await productionSpec(), input.content.componentRef);
  const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  const allowed = new Map<string, { revision: string; mimeType: string }>(),
    assets: { id: string; kind: string; revision: string; mimeType: string }[] = [];
  let slots: ReturnType<typeof componentAssets> = [];
  try {
    slots = componentAssets(input.content.props, definition.assetSlots);
  } catch {
    /* Incomplete drafts remain editable in LearnWeave. */
  }
  for (const slot of slots) {
    const match = /^\/api\/persistence\/assets\/([A-Za-z0-9_-]+)\/content$/.exec(slot.ref),
      id = match?.[1] || slot.ref.replace(/^asset:/, '');
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(id) || allowed.has(id)) continue;
    const meta = await provider.assetStore
      .identify(assetPrincipalForOwner(ownerId), id)
      .catch(() => null);
    if (
      !meta ||
      !meta.mime.startsWith(slot.kind + '/') ||
      meta.byteLength > (slot.kind === 'video' ? 100 : 20) * 1024 * 1024
    )
      continue;
    const descriptor = { revision: String(meta.revision), mimeType: meta.mime };
    allowed.set(id, descriptor);
    assets.push({ id, kind: slot.kind, ...descriptor });
  }
  const ticket = randomBytes(32).toString('hex');
  grants.set(ticket, { ownerId, expires: Date.now() + 30 * 60000, assets: allowed });
  try {
    const preview = await createComponentPreview({
      componentRef: definition.componentRef,
      props: input.content.props,
      parentOrigin,
      mode: input.mode,
      sourceTicket: ticket,
      assets,
    });
    hosted.set(preview.id, {
      ownerId,
      expires: preview.expiresAt,
      id: preview.id,
      token: preview.token,
    });
    return {
      id: preview.id,
      url: preview.url,
      expiresAt: preview.expiresAt,
      assetSlots: definition.assetSlots,
      thumbnailUrl: `/api/learnweave/component-previews/${preview.id}/thumbnail`,
    };
  } catch (e) {
    grants.delete(ticket);
    throw e;
  }
}
export async function previewAsset(ticket: string, id: string) {
  prune();
  const grant = grants.get(ticket),
    descriptor = grant?.assets.get(id);
  if (!grant || !descriptor) throw new ProductionError('预览素材不存在', 404);
  const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  const meta = await provider.assetStore.identify(assetPrincipalForOwner(grant.ownerId), id);
  if (!meta || String(meta.revision) !== descriptor.revision || meta.mime !== descriptor.mimeType)
    throw new ProductionError('预览素材已改变', 409);
  const value = await provider.assetStore.resolve(assetPrincipalForOwner(grant.ownerId), id);
  if (!value || String(value.revision) !== descriptor.revision)
    throw new ProductionError('预览素材不存在', 404);
  return { bytes: value.bytes, mimeType: value.mime, revision: descriptor.revision };
}
export async function hostedThumbnail(ownerId: string, id: string) {
  prune();
  const preview = hosted.get(id);
  if (!preview || preview.ownerId !== ownerId) throw new ProductionError('预览不存在', 404);
  return componentPreviewThumbnail(preview.id, preview.token);
}
