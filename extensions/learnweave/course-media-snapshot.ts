import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CLASSROOMS_DIR, classroomMediaMimeType, sniffAudioContainer } from './media-adapter';
/** Read only narration already generated in this authorized course. No URL fetch. */
export async function ownedCourseAudio(reference: string, stageId: string) {
  if (!reference.startsWith('/api/classroom-media/')) return null;
  const match =
    /^\/api\/classroom-media\/([A-Za-z0-9_-]+)\/(media|audio)\/([A-Za-z0-9_-]+\.[A-Za-z0-9]+)$/.exec(
      reference,
    );
  if (!match || match[1] !== stageId) throw Error('旁白音频不属于当前课程，或文件路径无效');
  const base = path.join(await fs.realpath(CLASSROOMS_DIR), stageId);
  const file = await fs.realpath(path.join(base, match[2], match[3])).catch(() => {
    throw Error('已生成的旁白文件不存在，请重新生成音频');
  });
  if (!file.startsWith(base + path.sep)) throw Error('旁白文件超出当前课程范围');
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 3 * 1024 * 1024)
    throw Error('旁白文件过大，需先保存至作者素材库');
  const bytes = await fs.readFile(file),
    format = sniffAudioContainer(bytes);
  const mimeType =
    format && !['m4a', 'webm'].includes(format) ? classroomMediaMimeType('.' + format) : undefined;
  if (!mimeType?.startsWith('audio/')) throw Error('旁白文件不是受支持的音频格式');
  return { bytes, mimeType, sha256: createHash('sha256').update(bytes).digest('hex') };
}
