import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CLASSROOMS_DIR } from '@/lib/server/classroom-storage';
import { storeGeneratedAssetOrThrow } from '@/lib/server/store-generated-asset';
import {
  assertOwnedWrite,
  assetPrincipalForOwner,
  getServerPersistenceProvider,
  type ToolDeps,
} from '../adapter';
import type { componentAssets } from './protocol';

/** Bridge native narration audio into the same owner asset pool as generated images. */
export async function importClassroomAudio(input: {
  deps: ToolDeps;
  stageId: string;
  props: Record<string, unknown>;
  resources: ReturnType<typeof componentAssets>;
  signal?: AbortSignal;
  cache: Map<string, string>;
}) {
  const local = input.resources.filter((r) => r.ref.startsWith('/api/classroom-media/'));
  if (!local.length) return;
  const files = local.map((r) => {
    const match =
      /^\/api\/classroom-media\/([A-Za-z0-9_-]+)\/media\/(tts-[A-Za-z0-9_-]+\.(mp3|wav|ogg))$/.exec(
        r.ref,
      );
    if (!match || match[1] !== input.stageId || r.kind !== 'audio')
      throw Error('只能导入当前课堂生成的 TTS 音频');
    return { resource: r, filename: match[2]!, extension: match[3]! };
  });
  const ownerId = await input.deps.currentOwner();
  const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  // Authorize before touching local files, and again inside the allocation transaction.
  await provider.withTransaction((tx) =>
    assertOwnedWrite(tx, ownerId, input.stageId, input.deps.fence),
  );
  const root = await realpath(CLASSROOMS_DIR);
  const directory = path.join(root, input.stageId, 'media') + path.sep;
  const maxBytes = 20 * 1024 * 1024;
  for (const { resource, filename, extension } of files) {
    input.signal?.throwIfAborted();
    const key = JSON.stringify(['classroom-audio', ownerId, input.stageId, resource.ref]);
    let assetId = input.cache.get(key);
    if (
      assetId &&
      !(
        await provider.assetStore.identify(assetPrincipalForOwner(ownerId), assetId)
      )?.mime?.startsWith('audio/')
    )
      assetId = undefined;
    if (!assetId) {
      const file = await realpath(path.join(directory, filename));
      if (!file.startsWith(directory)) throw Error('TTS 音频路径无效');
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Buffer;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || !stat.size || stat.size > maxBytes)
          throw Error('TTS 音频为空或超过大小限制');
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of handle.createReadStream({ autoClose: false })) {
          input.signal?.throwIfAborted();
          size += chunk.length;
          if (size > maxBytes) throw Error('TTS 音频超过大小限制');
          chunks.push(chunk);
        }
        bytes = Buffer.concat(chunks);
      } finally {
        await handle.close();
      }
      const mp3 =
        bytes.subarray(0, 3).toString() === 'ID3' ||
        (bytes[0] === 255 && ((bytes[1] || 0) & 224) === 224);
      const wav =
        bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE';
      const ogg = bytes.subarray(0, 4).toString() === 'OggS';
      const mimeType =
        extension === 'mp3' && mp3
          ? 'audio/mpeg'
          : extension === 'wav' && wav
            ? 'audio/wav'
            : extension === 'ogg' && ogg
              ? 'audio/ogg'
              : undefined;
      if (!mimeType) throw Error('TTS 音频真实格式与扩展名不匹配');
      input.signal?.throwIfAborted();
      assetId = await storeGeneratedAssetOrThrow({
        ownerId,
        stageId: input.stageId,
        kind: 'audio',
        mimeType,
        bytes,
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
    const parts = resource.path
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
