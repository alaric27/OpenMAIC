import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { CLASSROOMS_DIR } from '@/lib/server/classroom-storage';
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  authorize: vi.fn(),
  identify: vi.fn(),
}));
vi.mock('@/lib/server/store-generated-asset', () => ({ storeGeneratedAssetOrThrow: mocks.save }));
vi.mock('@/extensions/learnweave/adapter', () => ({
  assertOwnedWrite: mocks.authorize,
  assetPrincipalForOwner: (owner: string) => owner,
  getServerPersistenceProvider: async () => ({
    withTransaction: (fn: any) => fn('tx'),
    assetStore: { identify: mocks.identify },
  }),
}));
import { importClassroomAudio } from '@/extensions/learnweave/components/classroom-audio';
let directory: string, stageId: string;
beforeAll(async () => {
  await mkdir(CLASSROOMS_DIR, { recursive: true });
  directory = await mkdtemp(path.join(CLASSROOMS_DIR, 'tts-bridge-test-'));
  stageId = path.basename(directory);
  await mkdir(path.join(directory, 'media'));
  await writeFile(
    path.join(directory, 'media', 'tts-test.mp3'),
    Buffer.from('ID3valid-test-audio'),
  );
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.save.mockResolvedValue('ast_audio');
  mocks.authorize.mockResolvedValue(undefined);
  mocks.identify.mockResolvedValue({ mime: 'audio/mpeg' });
});
function input(ref = `/api/classroom-media/${stageId}/media/tts-test.mp3`) {
  return {
    deps: { currentOwner: async () => 'owner', fence: vi.fn() } as any,
    stageId,
    props: { audioUrl: ref },
    resources: [{ ref, path: '/audioUrl', kind: 'audio' as const }],
    cache: new Map<string, string>(),
  };
}
it('imports native TTS bytes and reuses the owned allocation on retries', async () => {
  const a = input();
  await importClassroomAudio(a);
  expect(a.props.audioUrl).toBe('ast_audio');
  expect(mocks.save).toHaveBeenCalledWith(
    expect.objectContaining({
      ownerId: 'owner',
      stageId,
      kind: 'audio',
      mimeType: 'audio/mpeg',
      bytes: Buffer.from('ID3valid-test-audio'),
    }),
  );
  const retry = { ...input(), cache: a.cache };
  await importClassroomAudio(retry);
  expect(retry.props.audioUrl).toBe('ast_audio');
  expect(mocks.save).toHaveBeenCalledOnce();
  await mocks.save.mock.calls[0][0].fence('allocation-tx');
  expect(mocks.authorize).toHaveBeenCalledWith('allocation-tx', 'owner', stageId, a.deps.fence);
});
it.each(['../secret', '%2e%2e%2fsecret', 'tts-test.mp3?x=1'])(
  'rejects malformed paths before allocation: %s',
  async (filename) => {
    await expect(
      importClassroomAudio(input(`/api/classroom-media/${stageId}/media/${filename}`)),
    ).rejects.toThrow();
    expect(mocks.save).not.toHaveBeenCalled();
  },
);
it('rejects cross-stage audio and non-audio slots', async () => {
  await expect(
    importClassroomAudio(input('/api/classroom-media/other-stage/media/tts-test.mp3')),
  ).rejects.toThrow('当前课堂');
  const a = input();
  (a.resources[0] as any).kind = 'image';
  await expect(importClassroomAudio(a)).rejects.toThrow();
  expect(mocks.save).not.toHaveBeenCalled();
});
it('checks ownership before reading local files', async () => {
  mocks.authorize.mockRejectedValue(new Error('not owned'));
  await expect(
    importClassroomAudio(input(`/api/classroom-media/${stageId}/media/tts-missing.mp3`)),
  ).rejects.toThrow('not owned');
  expect(mocks.save).not.toHaveBeenCalled();
});
it('rejects disguised content and symlinks outside the classroom media directory', async () => {
  await writeFile(path.join(directory, 'media', 'tts-html.mp3'), '<html>not audio</html>');
  await expect(
    importClassroomAudio(input(`/api/classroom-media/${stageId}/media/tts-html.mp3`)),
  ).rejects.toThrow('格式');
  await writeFile(path.join(directory, 'outside.mp3'), 'ID3outside');
  await symlink(path.join(directory, 'outside.mp3'), path.join(directory, 'media', 'tts-link.mp3'));
  await expect(
    importClassroomAudio(input(`/api/classroom-media/${stageId}/media/tts-link.mp3`)),
  ).rejects.toThrow('路径');
  expect(mocks.save).not.toHaveBeenCalled();
});
it('honors cancellation and asset quota refusal', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(importClassroomAudio({ ...input(), signal: controller.signal })).rejects.toThrow();
  expect(mocks.save).not.toHaveBeenCalled();
  mocks.save.mockRejectedValue(new Error('storage full'));
  const a = input();
  await expect(importClassroomAudio(a)).rejects.toThrow('storage full');
  expect(a.props.audioUrl).toContain('/api/classroom-media/');
  expect(a.cache.size).toBe(0);
});
