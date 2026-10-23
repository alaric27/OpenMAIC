import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
// Only the application's bundled PNG/JPEG/WebP avatars. Never fetch a source
// content URL or interpret an arbitrary resource path as a local filename.
export async function bundledAvatar(
  reference: string,
  publicRoot = resolve(process.cwd(), 'public'),
) {
  const match = /^\/avatars\/([A-Za-z0-9_-]+)\.(png|jpg|webp)$/.exec(reference);
  if (!match) return null;
  const bytes = await readFile(resolve(publicRoot, `avatars/${match[1]}.${match[2]}`)).catch(() => {
    throw Error('内置头像无法读取，请选择已保存的图片素材');
  });
  if (!bytes.length || bytes.length > 3 * 1024 * 1024) throw Error('内置头像超过导出大小限制');
  return {
    bytes,
    mimeType: match[2] === 'jpg' ? 'image/jpeg' : `image/${match[2]}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
