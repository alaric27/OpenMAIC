import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({ root: '', put: vi.fn() }));
vi.mock('@/lib/server/classroom-storage', async (actual) => ({
  ...(await actual<object>()),
  get CLASSROOMS_DIR() {
    return mocks.root;
  },
}));
vi.mock('@/lib/server/store-generated-asset', () => ({ storeGeneratedAssetOrThrow: mocks.put }));
import { resolveAudioReference } from '@/extensions/learnweave/audio-reference';

let root: string;
const fence = vi.fn();
const resolve = (src: string) =>
  resolveAudioReference({ src, stageId: 'course', ownerId: 'owner', fence });
beforeEach(async () => {
  vi.clearAllMocks();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lw-audio-'));
  mocks.root = root;
  await fs.mkdir(path.join(root, 'course', 'media'), { recursive: true });
  mocks.put.mockResolvedValue('saved-audio');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('template audio references', () => {
  it('imports same-course TTS bytes into the owned asset pool with the actual MIME', async () => {
    const wav = Buffer.alloc(44);
    wav.write('RIFF');
    wav.writeUInt32LE(36, 4);
    wav.write('WAVE', 8);
    await fs.writeFile(path.join(root, 'course/media/tts-test.mp3'), wav);
    expect(await resolve('/api/classroom-media/course/media/tts-test.mp3')).toBe('saved-audio');
    expect(mocks.put).toHaveBeenCalledWith({
      ownerId: 'owner',
      stageId: 'course',
      kind: 'audio',
      bytes: wav,
      mimeType: 'audio/wav',
      fence,
    });
  });
  it('accepts existing saved references without allocating or reading files', async () => {
    expect(await resolve('saved-audio')).toBe('saved-audio');
    expect(await resolve('/api/persistence/assets/saved-audio/content')).toBe('saved-audio');
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it.each([
    '/api/classroom-media/other/media/test.wav',
    '/api/classroom-media/course/media/../test.wav',
    '/api/classroom-media/course/media/%2e%2e.wav',
    'https://example.com/audio.wav',
  ])('rejects cross-course, traversal and external input: %s', async (src) => {
    await expect(resolve(src)).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_/) });
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it('rejects an image renamed to audio and an escaping symlink', async () => {
    await fs.writeFile(path.join(root, 'course/media/image.wav'), Buffer.from('PNG image'));
    await expect(resolve('/api/classroom-media/course/media/image.wav')).rejects.toMatchObject({
      code: 'ASSET_TYPE_MISMATCH',
    });
    await fs.writeFile(path.join(root, 'outside.wav'), Buffer.from('RIFFxxxxWAVE'));
    await fs.symlink(path.join(root, 'outside.wav'), path.join(root, 'course/media/link.wav'));
    await expect(resolve('/api/classroom-media/course/media/link.wav')).rejects.toMatchObject({
      code: 'AUDIO_FILE_UNAVAILABLE',
    });
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it('returns a repair instruction for a missing file and honors cancellation', async () => {
    await expect(resolve('/api/classroom-media/course/media/missing.wav')).rejects.toMatchObject({
      code: 'AUDIO_FILE_UNAVAILABLE',
      message: expect.stringContaining('promptText'),
    });
    const abort = new AbortController();
    abort.abort();
    await expect(
      resolveAudioReference({
        src: '/api/classroom-media/course/media/missing.wav',
        stageId: 'course',
        ownerId: 'owner',
        fence,
        signal: abort.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
