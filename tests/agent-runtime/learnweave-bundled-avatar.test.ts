import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundledAvatar } from '../../extensions/learnweave/bundled-avatar';
it('embeds only bundled avatar files with a byte hash and rejects arbitrary paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lw-avatar-'));
  try {
    await mkdir(join(root, 'avatars'));
    await writeFile(join(root, 'avatars', 'teacher.png'), Buffer.from('known fixture bytes'));
    const result = await bundledAvatar('/avatars/teacher.png', root);
    expect(result?.bytes.toString()).toBe('known fixture bytes');
    expect(result?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result?.mimeType).toBe('image/png');
    expect(await bundledAvatar('/avatars/../secret.png', root)).toBeNull();
    expect(await bundledAvatar('https://example.com/avatars/teacher.png', root)).toBeNull();
    expect(await bundledAvatar('/etc/passwd', root)).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('narration snapshots reject cross-course paths and never fetch external URLs', async () => {
  const { ownedCourseAudio } = await import('../../extensions/learnweave/course-media-snapshot');
  await expect(
    ownedCourseAudio('/api/classroom-media/foreign/media/test.mp3', 'current'),
  ).rejects.toThrow('不属于当前课程');
  await expect(
    ownedCourseAudio('/api/classroom-media/current/media/../test.mp3', 'current'),
  ).rejects.toThrow('路径无效');
  expect(await ownedCourseAudio('https://example.com/audio.mp3', 'current')).toBeNull();
});
