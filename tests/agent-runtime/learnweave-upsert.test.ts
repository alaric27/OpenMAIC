import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  identify: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  audio: vi.fn(),
  resolveAudio: vi.fn(),
}));
vi.mock('@/extensions/learnweave/adapter', async (actual) => ({
  ...(await actual<object>()),
  wrapTools: async (tools: unknown) => tools,
}));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({ assetStore: { identify: mocks.identify } }),
}));
vi.mock('@/extensions/learnweave/store', () => ({
  readTemplates: mocks.read,
  writeTemplates: mocks.write,
}));
vi.mock('@/extensions/learnweave/media', () => ({ promptAudio: mocks.audio }));
vi.mock('@/extensions/learnweave/audio-reference', () => ({
  resolveAudioReference: mocks.resolveAudio,
}));
import type { ToolDeps, CourseDocument } from '@/extensions/learnweave/adapter';
import { buildLearnWeaveTools } from '@/extensions/learnweave';
import { buildActivity } from '@/extensions/learnweave/templates';
import { ActivityInputError } from '@/extensions/learnweave/errors';

const params = () => ({
  stageId: 'course',
  activityId: 'listen',
  templateId: 'practice.listen-image',
  title: 'Listen',
  order: 0,
  expectedRevision: 0,
  audioSrc: 'image-id',
  hints: [],
  maxAttempts: 3,
  answer: 'A',
  options: [
    { value: 'A', label: 'apple', imageSrc: 'image-id' },
    { value: 'B', label: 'bread', imageSrc: 'bread-id' },
  ],
});
async function fixture(initial?: CourseDocument) {
  let doc: CourseDocument = {
    stage: { id: 'course', name: 'Test', createdAt: 1, updatedAt: 1 },
    scenes: [],
  };
  if (initial) doc = initial;
  const store = {
    loadDocument: vi.fn(async () => structuredClone(doc)),
    saveDocument: vi.fn(async (next: CourseDocument) => {
      doc = structuredClone(next);
    }),
  };
  const tools = await buildLearnWeaveTools({
    store,
    currentOwner: async () => 'owner',
    onCheckpoint: vi.fn(),
    fence: vi.fn(),
  } as unknown as ToolDeps);
  const tool = tools.find((t) => t.name === 'lw_upsert_activity')!;
  return {
    store,
    call: async (args: object) =>
      (await tool.execute('call', args, new AbortController().signal)).details,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('LEARNWEAVE_EXTENSION_ENABLED', 'true');
  mocks.read.mockResolvedValue(null);
  mocks.write.mockImplementation(async (_s, _o, revision, manifest) => ({
    ...manifest,
    revision: revision + 1,
  }));
  mocks.identify.mockImplementation(async (_owner, id) => ({
    mime: id === 'saved-audio' ? 'audio/wav' : 'image/png',
  }));
  mocks.resolveAudio.mockImplementation(async ({ src }) => src);
  mocks.audio.mockResolvedValue('saved-audio');
});
afterEach(() => vi.unstubAllEnvs());

describe('typed activity saving and retry control', () => {
  it('rejects image-as-audio before saving, blocks identical invalid input even with a new revision, and permits corrected TTS input', async () => {
    const { call, store } = await fixture();
    const first = await call(params());
    expect(first).toMatchObject({
      code: 'ASSET_TYPE_MISMATCH',
      retryable: false,
      field: 'audioSrc',
    });
    expect(store.saveDocument).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    const reads = mocks.read.mock.calls.length,
      identifies = mocks.identify.mock.calls.length;
    expect(await call({ ...params(), expectedRevision: 12 })).toMatchObject({
      repeatedInput: true,
      retryable: false,
    });
    expect(mocks.read).toHaveBeenCalledTimes(reads);
    expect(mocks.identify).toHaveBeenCalledTimes(identifies);
    expect(await call({ ...params(), audioSrc: undefined, promptText: 'apple' })).toMatchObject({
      status: 'ready',
    });
    expect(mocks.audio).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(store.saveDocument.mock.calls[0])).toContain(
      '/api/persistence/assets/saved-audio/content',
    );
  });
  it('allows repairing one activity while another legacy binding still needs repair', async () => {
    const old = buildActivity({
      ...params(),
      activityId: 'other',
      templateId: 'practice.listen-image',
      audioSrc: 'image-id',
    });
    mocks.read.mockResolvedValue({ revision: 0, manifest: { activities: [old.activity] } });
    const { call } = await fixture({
      stage: { id: 'course', name: 'Test', createdAt: 1, updatedAt: 1 },
      scenes: old.scenes,
    });
    expect(await call({ ...params(), audioSrc: 'saved-audio' })).toMatchObject({ status: 'ready' });
  });
  it('normalizes legacy audio and does not mutate the model arguments', async () => {
    mocks.resolveAudio.mockResolvedValue('saved-audio');
    const { call } = await fixture();
    const args = { ...params(), audioSrc: '/api/classroom-media/course/media/tts-test.wav' };
    expect(await call(args)).toMatchObject({ status: 'ready' });
    expect(args.audioSrc).toBe('/api/classroom-media/course/media/tts-test.wav');
    expect(mocks.audio).not.toHaveBeenCalled();
  });
  it('identifies revision conflicts as retryable without generating audio or saving', async () => {
    mocks.read.mockResolvedValue({ revision: 4 });
    const { call, store } = await fixture();
    expect(await call(params())).toMatchObject({ code: 'REVISION_CONFLICT', retryable: true });
    expect(mocks.resolveAudio).not.toHaveBeenCalled();
    expect(store.saveDocument).not.toHaveBeenCalled();
  });
  it('reports schema field errors and blocks unsupported audio URL retries', async () => {
    const { call } = await fixture();
    expect(await call({ ...params(), order: -1 })).toMatchObject({
      code: 'INVALID_ACTIVITY_PARAMETERS',
      retryable: false,
      fields: expect.any(Array),
    });
    mocks.resolveAudio.mockRejectedValue(
      new ActivityInputError('INVALID_AUDIO_REFERENCE', 'Invalid audio', 'audioSrc'),
    );
    expect(await call(params())).toMatchObject({
      code: 'INVALID_AUDIO_REFERENCE',
      retryable: false,
    });
    expect(await call(params())).toMatchObject({ repeatedInput: true });
    expect(mocks.resolveAudio).toHaveBeenCalledTimes(1);
  });
});
