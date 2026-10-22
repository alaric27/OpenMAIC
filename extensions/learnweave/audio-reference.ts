import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CLASSROOMS_DIR, classroomMediaMimeType } from '@/lib/server/classroom-storage';
import { sniffAudioContainer } from '@/lib/media/sniff-audio-container';
import { storeGeneratedAssetOrThrow } from '@/lib/server/store-generated-asset';
import type { Queryable } from '@openmaic/storage/document/pg';
import { sourceAssetId } from './templates';
import { ActivityInputError } from './errors';

/** Called only after owner-scoped stage authorization. Never fetch arbitrary URLs. */
export async function resolveAudioReference(input: {
  src: string;
  stageId: string;
  ownerId: string;
  signal?: AbortSignal;
  fence: (tx: Queryable) => Promise<void>;
}): Promise<string> {
  if (!input.src.startsWith('/api/classroom-media/')) return sourceAssetId(input.src);
  const match =
    /^\/api\/classroom-media\/([A-Za-z0-9_-]+)\/(media|audio)\/([A-Za-z0-9_-]+\.[A-Za-z0-9]+)$/.exec(
      input.src,
    );
  if (!match || match[1] !== input.stageId) {
    throw new ActivityInputError(
      'INVALID_AUDIO_REFERENCE',
      'audioSrc must refer to a file in this owned course; cross-course paths and traversal are not accepted.',
      'audioSrc',
    );
  }
  let bytes: Buffer;
  try {
    input.signal?.throwIfAborted();
    const base = path.join(await fs.realpath(CLASSROOMS_DIR), input.stageId);
    const real = await fs.realpath(path.join(base, match[2], match[3]));
    if (!real.startsWith(base + path.sep)) throw new Error('Path outside course');
    const stat = await fs.stat(real);
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('Invalid audio file size');
    bytes = await fs.readFile(real, { signal: input.signal });
  } catch {
    input.signal?.throwIfAborted();
    throw new ActivityInputError(
      'AUDIO_FILE_UNAVAILABLE',
      'The course audio file is missing or cannot be imported. Omit audioSrc and supply promptText to synthesize a saved audio asset.',
      'audioSrc',
    );
  }
  const format = sniffAudioContainer(bytes);
  // WebM/MP4 can contain video too. This bridge accepts the unambiguous TTS containers.
  const mime =
    format && !['m4a', 'webm'].includes(format) ? classroomMediaMimeType('.' + format) : undefined;
  if (!mime?.startsWith('audio/')) {
    throw new ActivityInputError(
      'ASSET_TYPE_MISMATCH',
      'audioSrc file does not contain a supported audio stream. Never substitute an image ID; omit audioSrc and supply promptText for TTS.',
      'audioSrc',
    );
  }
  input.signal?.throwIfAborted();
  return storeGeneratedAssetOrThrow({
    ownerId: input.ownerId,
    stageId: input.stageId,
    kind: 'audio',
    bytes,
    mimeType: mime,
    fence: input.fence,
  });
}
