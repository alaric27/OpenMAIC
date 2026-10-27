import { readPlanMedia } from '../client';
import { extractObservedUrls } from '@openmaic/storage';
import { fetchProviderResultUrl } from '@/lib/server/provider-result-fetch';
import { capBodyStream } from '@/lib/server/capped-stream';
import { storeGeneratedAssetOrThrow } from '@/lib/server/store-generated-asset';
import {
  assertOwnedWrite,
  getServerPersistenceProvider,
  assetPrincipalForOwner,
  type ToolDeps,
} from '../adapter';
import type { ProductionSpec } from '../transport-types';
import type { componentAssets } from './protocol';

type Resource = ReturnType<typeof componentAssets>[number];
export type PlanSelection = { id: string; revision: number };
/** Exact URLs from this published plan only; this never changes fetch_url's session allowlist. */
export function planMediaUrls(value: unknown): Set<string> {
  const urls = new Set<string>();
  function visit(part: unknown) {
    if (typeof part === 'string') for (const url of extractObservedUrls(part)) urls.add(url);
    else if (Array.isArray(part)) part.forEach(visit);
    else if (part && typeof part === 'object') Object.values(part).forEach(visit);
  }
  visit(value);
  return urls;
}
function mediaMime(bytes: Uint8Array, kind: Resource['kind']): string {
  const b = Buffer.from(bytes);
  const text = (offset: number, length: number) => b.toString('ascii', offset, offset + length);
  let mime: string | undefined;
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = 'image/png';
  else if (b[0] === 255 && b[1] === 216 && b[2] === 255) mime = 'image/jpeg';
  else if (/^GIF8[79]a$/.test(text(0, 6))) mime = 'image/gif';
  else if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') mime = 'image/webp';
  else if (text(0, 3) === 'ID3' || (b[0] === 255 && ((b[1] || 0) & 224) === 224))
    mime = 'audio/mpeg';
  else if (text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE') mime = 'audio/wav';
  else if (text(0, 4) === 'OggS') mime = kind === 'audio' ? 'audio/ogg' : 'video/ogg';
  else if (b.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])))
    mime = kind === 'audio' ? 'audio/webm' : 'video/webm';
  else if (text(4, 4) === 'ftyp') mime = 'video/mp4';
  if (!mime?.startsWith(kind + '/')) throw Error('计划素材的真实格式与组件素材字段不匹配');
  return mime;
}
/** Imports are owner-scoped, lease-fenced, byte-bounded, and reused across this toolset's calls. */
export async function importPlanMedia(input: {
  deps: ToolDeps;
  stageId: string;
  selection?: PlanSelection;
  spec: ProductionSpec;
  resources: Resource[];
  props: Record<string, unknown>;
  signal?: AbortSignal;
  cache: Map<string, string>;
}): Promise<void> {
  const remote = input.resources.filter((r) => /^https?:\/\//i.test(r.ref));
  if (!remote.length) return;
  if (!input.selection)
    throw Error(
      '原课外链需要自动导入素材库：请用 lw_read_course_plan 获取已发布配置，在本工具传入 planSelection:{id,revision} 后重试；不需要用户重复上传或通过 fetch_url 抓取。',
    );
  const plan = input.spec.planVersions.find(
    (p) => p.value.id === input.selection!.id && p.revision === input.selection!.revision,
  );
  if (!plan) throw Error('素材导入引用的已发布课程配置不存在');
  const allowed = planMediaUrls(plan.value);
  // Validate the complete batch before the first fetch or allocation.
  for (const r of remote) {
    const url = new URL(r.ref);
    if (url.protocol !== 'https:' || url.username || url.password || !allowed.has(url.href))
      throw Error('素材 URL 不属于指定已发布课程配置，不能自动导入');
  }
  const ownerId = await input.deps.currentOwner();
  const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  for (const r of remote) {
    input.signal?.throwIfAborted();
    const key = JSON.stringify([ownerId, input.stageId, r.kind, new URL(r.ref).href]);
    let assetId = input.cache.get(key);
    if (
      assetId &&
      !(
        await provider.assetStore.identify(assetPrincipalForOwner(ownerId), assetId)
      )?.mime?.startsWith(r.kind + '/')
    )
      assetId = undefined;
    if (!assetId) {
      const limits = { image: 20 * 1024 * 1024, audio: 20 * 1024 * 1024, video: 100 * 1024 * 1024 };
      const policy = input.spec.assetPolicy as
        | { kinds?: Partial<Record<Resource['kind'], number>> }
        | undefined;
      const declared = policy?.kinds?.[r.kind];
      const maxBytes =
        typeof declared === 'number' && Number.isFinite(declared) && declared > 0
          ? Math.min(declared, limits[r.kind])
          : limits[r.kind];
      const signal = AbortSignal.any([
        AbortSignal.timeout(45000),
        ...(input.signal ? [input.signal] : []),
      ]);
      const response =
        (await readPlanMedia(input.selection!, r.ref, signal)) ||
        (await fetchProviderResultUrl(r.ref, { signal, maxBytes }));
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw Error(`计划素材下载失败（HTTP ${response.status}），请检查原课素材地址后重试`);
      }
      if (Number(response.headers.get('content-length')) > maxBytes) {
        await response.body.cancel();
        throw Error('计划素材超过大小限制');
      }
      const bounded = capBodyStream(response.body, maxBytes);
      const bytes = new Uint8Array(await new Response(bounded.stream).arrayBuffer());
      signal.throwIfAborted();
      const mimeType = mediaMime(bytes, r.kind);
      assetId = await storeGeneratedAssetOrThrow({
        ownerId,
        stageId: input.stageId,
        kind: r.kind,
        bytes,
        mimeType,
        fence: async (tx) => {
          input.signal?.throwIfAborted();
          await assertOwnedWrite(tx, ownerId, input.stageId, input.deps.fence);
        },
        afterPut: async () => {
          input.signal?.throwIfAborted();
        },
      });
      if (input.cache.size >= 128) input.cache.delete(input.cache.keys().next().value!);
      input.cache.set(key, assetId);
    }
    const parts = r.path
      .slice(1)
      .split('/')
      .map((v) => v.replace(/~1/g, '/').replace(/~0/g, '~'));
    let parent: any = input.props;
    for (const part of parts.slice(0, -1)) parent = parent[part];
    Object.defineProperty(parent, parts.at(-1)!, {
      value: assetId,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
}
