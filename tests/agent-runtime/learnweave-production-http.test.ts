import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contentSchema, assetSlots } from '@openmaic/scene-components';
const mocks = vi.hoisted(() => ({
  provider: vi.fn(),
  store: vi.fn(),
  ownedWrite: vi.fn(),
  spec: vi.fn(),
  resolve: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock('@/extensions/learnweave/adapter', () => ({
  getServerPersistenceProvider: mocks.provider,
  getOwnerScopedDocumentStore: mocks.store,
  assertOwnedWrite: mocks.ownedWrite,
  assetPrincipalForOwner: (owner: string) => owner,
}));
vi.mock('@openmaic/storage/pg-migrations', () => ({ applySchemaMigrations: vi.fn() }));
vi.mock('@/extensions/learnweave/course-media-snapshot', () => ({
  ownedCourseAudio: async () => null,
}));
vi.mock('@/extensions/learnweave/client', async (original) => ({
  ...(await original<object>()),
  productionSpec: mocks.spec,
  resolveAuthoring: mocks.resolve,
  prepareBundle: mocks.prepare,
}));
import { saveCourse, produceBundle } from '@/extensions/learnweave/production';

const hash = 'a'.repeat(64);
let source: { rev: number };
let row: any;
let query: ReturnType<typeof vi.fn>;
let transaction: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  source = { rev: 5 };
  row = {
    revision: 2,
    document_hash: hash,
    target_profile_id: 'current',
    manifest: {
      title: 'Food',
      language: 'en',
      level: 'A1',
      objectives: [{ id: 'food', description: 'Talk' }],
      activities: [
        { id: 'talk', kind: 'teaching', data: { method: 'picture-talk', sceneId: 'scene' } },
      ],
    },
  };
  query = vi.fn(async (sql: string) => ({
    rows: sql.includes('SELECT revision') ? [{ revision: row.revision }] : [],
  }));
  transaction = vi.fn(async (fn) => fn({ query }));
  mocks.provider.mockResolvedValue({
    pool: { query: vi.fn(async () => ({ rows: [structuredClone(row)] })) },
    withTransaction: transaction,
    assetStore: { identify: vi.fn() },
  });
  mocks.store.mockResolvedValue({
    readFreshnessManifest: vi.fn(async () => ({
      rev: source.rev,
      scenes: [{ id: 'scene', rev: source.rev, order: 0 }],
    })),
    loadDocument: vi.fn(async () => ({
      stage: { id: 'stage', name: 'Food', createdAt: 0, updatedAt: 0 },
      scenes: [
        {
          id: 'scene',
          type: 'slide',
          stageId: 'stage',
          title: 'Food',
          order: 0,
          content: { type: 'slide', canvas: { elements: [] } },
        },
      ],
    })),
  });
  mocks.spec.mockResolvedValue({
    producerApiVersion: 1,
    instanceId: 'local',
    authoringSchemaHash: hash,
    profile: { id: 'current' },
  });
  mocks.resolve.mockImplementation(async (_spec, _document, manifest) => {
    expect(transaction).not.toHaveBeenCalled();
    return { documentHash: hash, manifest: structuredClone(manifest), targetProfileId: 'current' };
  });
  mocks.prepare.mockImplementation(async (_spec, bundle) => ({
    ...bundle,
    source: { ...bundle.source, sourceDocumentHash: hash, bundleHash: hash },
  }));
});
describe('source persistence around HTTP preparation', () => {
  it('requires an explicit save for migrated drafts before preparing a Bundle', async () => {
    row.document_hash = '';
    await expect(produceBundle('owner', 'stage')).rejects.toMatchObject({ status: 409 });
    expect(mocks.prepare).not.toHaveBeenCalled();
    await expect(saveCourse('owner', 'stage', row.revision, row.manifest)).resolves.toMatchObject({
      revision: 3,
    });
  });
  it('resolves before entering the transaction and preserves owner/lease fences on save', async () => {
    const fence = vi.fn();
    const result = await saveCourse('owner', 'stage', 2, row.manifest, fence);
    expect(result.revision).toBe(3);
    expect(mocks.ownedWrite).toHaveBeenCalledWith(expect.anything(), 'owner', 'stage', fence);
    expect(
      query.mock.calls.some(([sql]) => sql.includes('INSERT INTO learnweave_course_definitions')),
    ).toBe(true);
  });
  it('does not persist when the service fails', async () => {
    mocks.resolve.mockRejectedValueOnce(new Error('service unavailable'));
    await expect(saveCourse('owner', 'stage', 2, row.manifest)).rejects.toThrow('unavailable');
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rejects a native document changed during the resolve request', async () => {
    mocks.resolve.mockImplementationOnce(async () => {
      source.rev++;
      return { documentHash: hash, manifest: row.manifest };
    });
    await expect(saveCourse('owner', 'stage', 2, row.manifest)).rejects.toMatchObject({
      status: 409,
    });
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(false);
  });
  it('rejects a stale manifest revision before writing', async () => {
    await expect(saveCourse('owner', 'stage', 1, row.manifest)).rejects.toMatchObject({
      status: 409,
    });
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(false);
  });
  it('exports through the rule service without mutating the persisted manifest', async () => {
    const before = structuredClone(row.manifest);
    const bundle = await produceBundle('owner', 'stage');
    expect(bundle.source).toMatchObject({
      nativeRevision: 5,
      learningRevision: 2,
      sourceDocumentHash: hash,
      bundleHash: hash,
    });
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(row.manifest).toEqual(before);
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each(['document', 'manifest'])(
    'rejects %s changes during Bundle preparation',
    async (kind) => {
      mocks.prepare.mockImplementationOnce(async (_spec, bundle) => {
        if (kind === 'document') source.rev++;
        else row.revision++;
        return {
          ...bundle,
          source: { ...bundle.source, sourceDocumentHash: hash, bundleHash: hash },
        };
      });
      await expect(produceBundle('owner', 'stage')).rejects.toMatchObject({ status: 409 });
    },
  );
  it('requires an explicit resave after manual native edits', async () => {
    row.document_hash = 'b'.repeat(64);
    await expect(produceBundle('owner', 'stage')).rejects.toThrow('重新保存');
  });
});

describe('component asset export', () => {
  it.each(['picture-teaching', 'video-player'])(
    'binds %s owned media without scanning descriptions',
    async (id) => {
      const store =
        (await mocks.store.mock.results[0]?.value) ||
        (await (
          await import('@/extensions/learnweave/adapter')
        ).getOwnerScopedDocumentStore('owner'));
      const video = id === 'video-player';
      const spec = await mocks.spec();
      spec.templateVersions = [
        {
          revision: 1,
          value: {
            id: 'component-test',
            sceneType: 'component',
            componentRef: { id, version: '1.0.0' },
            contentSchema: contentSchema({ id, version: '1.0.0' }),
            assetSlots: assetSlots({ id, version: '1.0.0' }),
          },
        },
      ];
      store.loadDocument.mockResolvedValue({
        stage: { id: 'stage', name: 'Component', createdAt: 0, updatedAt: 0 },
        scenes: [
          {
            id: 'scene',
            stageId: 'stage',
            type: 'component',
            title: 'Component',
            order: 0,
            content: {
              type: 'component',
              componentRef: { id, version: '1.0.0' },
              props: video
                ? { videoUrl: 'owned-media', videoDescribe: 'https://not-a-resource.example' }
                : {
                    text: 'camel',
                    imageUrl: 'owned-media',
                    imageDescribe: 'https://not-a-resource.example',
                  },
            },
          },
        ],
      });
      const provider = await mocks.provider();
      provider.assetStore.resolve = vi.fn(async () => ({
        mime: video ? 'video/mp4' : 'image/png',
        revision: 1,
        bytes: Buffer.from('test-media'),
      }));
      provider.assetStore.identify.mockResolvedValue({ revision: 1 });
      const b = await produceBundle('owner', 'stage');
      expect(b.assets).toHaveLength(1);
      expect((b.course as any).assetBindings).toEqual([
        {
          documentPointer: `/scenes/0/content/props/${video ? 'videoUrl' : 'imageUrl'}`,
          assetId: b.assets[0].id,
        },
      ]);
      expect(b.assets[0].kind).toBe(video ? 'video' : 'image');
    },
  );
});
