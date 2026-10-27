import { beforeEach, it, expect, vi } from 'vitest';
import { contentSchema, assetSlots } from './component-contract-fixtures';
const mocks = vi.hoisted(() => ({
  spec: vi.fn(),
  provider: vi.fn(),
  fetchMedia: vi.fn(),
  saveAsset: vi.fn(),
  ownedWrite: vi.fn(),
  planMedia: vi.fn(),
}));
vi.mock('@/lib/server/provider-result-fetch', () => ({ fetchProviderResultUrl: mocks.fetchMedia }));
vi.mock('@/lib/server/store-generated-asset', () => ({
  storeGeneratedAssetOrThrow: mocks.saveAsset,
}));
vi.mock('@/extensions/learnweave/client', () => ({
  productionSpec: mocks.spec,
  readPlanMedia: mocks.planMedia,
}));
vi.mock('@/extensions/learnweave/adapter', () => ({
  runStageMutation: async (_s: unknown, fn: () => unknown) => fn(),
  getServerPersistenceProvider: mocks.provider,
  assetPrincipalForOwner: (o: string) => o,
  assertOwnedWrite: mocks.ownedWrite,
}));
import { componentSceneTool } from '@/extensions/learnweave/components/production';
import { validateAppScene } from '@/lib/document-store/validators';
import { enumerateAssetManifest } from '@openmaic/dsl';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.planMedia.mockResolvedValue(null);
  mocks.spec.mockResolvedValue({
    templateVersions: [
      {
        revision: 1,
        value: {
          id: 'teaching-picture',
          sceneType: 'component',
          componentRef: { id: 'picture-teaching', version: '1.0.0' },
          contentSchema: contentSchema({ id: 'picture-teaching', version: '1.0.0' }),
          assetSlots: assetSlots({ id: 'picture-teaching', version: '1.0.0' }),
        },
      },
    ],
  });
  mocks.provider.mockResolvedValue({
    assetStore: { identify: vi.fn(async () => ({ mime: 'image/png', revision: 1 })) },
  });
});
it('creates a validated owned single-page scene, preserving other scene data', async () => {
  const putScene = vi.fn();
  const checkpoint = vi.fn();
  const tool = componentSceneTool({
    store: { loadDocument: async () => ({ scenes: [{ id: 'existing', order: 1 }] }), putScene },
    currentOwner: async () => 'owner',
    onCheckpoint: checkpoint,
  } as any);
  const result = await tool.execute('call', {
    stageId: 'stage',
    sceneId: 'scene-picture',
    title: 'Camel',
    order: 2,
    templateId: 'teaching-picture',
    templateRevision: 1,
    props: { text: 'camel', imageUrl: 'owned-image', imageDescribe: 'A camel' },
  });
  expect((result as any).isError).not.toBe(true);
  expect(putScene).toHaveBeenCalledOnce();
  const scene = putScene.mock.calls[0][1];
  expect(validateAppScene(scene).valid).toBe(true);
  expect(
    enumerateAssetManifest({ stage: {} as any, scenes: [scene] }).referenceCounts.get(
      'owned-image',
    ),
  ).toBe(1);
  expect(checkpoint).toHaveBeenCalledWith(
    expect.objectContaining({ tool: 'lw_save_component_scene' }),
  );
});
it('rejects wrong asset type, unknown content and overwriting another scene type', async () => {
  const putScene = vi.fn();
  const deps = {
    store: {
      loadDocument: async () => ({ scenes: [{ id: 'scene-picture', order: 1, type: 'slide' }] }),
      putScene,
    },
    currentOwner: async () => 'owner',
    onCheckpoint: vi.fn(),
  } as any;
  const tool = componentSceneTool(deps);
  const input = {
    stageId: 'stage',
    sceneId: 'scene-picture',
    title: 'Camel',
    order: 1,
    templateId: 'teaching-picture',
    templateRevision: 1,
    props: { text: 'camel', imageUrl: 'owned-image', imageDescribe: 'A camel' },
  };
  expect(((await tool.execute('call', input)) as any).isError).toBe(true);
  expect(
    ((await tool.execute('call', { ...input, props: { ...input.props, pages: '[]' } })) as any)
      .isError,
  ).toBe(true);
  mocks.provider.mockResolvedValue({
    assetStore: { identify: async () => ({ mime: 'video/mp4' }) },
  });
  expect(((await tool.execute('call', input)) as any).isError).toBe(true);
  expect(putScene).not.toHaveBeenCalled();
});

it('accepts future nested props and media fields from LearnWeave without a local template branch', async () => {
  const remote = {
    id: 'teaching-cards',
    sceneType: 'component',
    componentRef: { id: 'cards', version: '1.0.0' },
    contentSchema: {
      type: 'object',
      required: ['cards'],
      additionalProperties: false,
      properties: {
        cards: {
          type: 'array',
          items: {
            type: 'object',
            required: ['picture', 'label'],
            additionalProperties: false,
            properties: { picture: { type: 'string' }, label: { type: 'string' } },
          },
        },
      },
    },
    assetSlots: [{ path: '/cards/*/picture', kind: 'image' }],
  };
  mocks.spec.mockResolvedValue({ templateVersions: [{ revision: 3, value: remote }] });
  const putScene = vi.fn();
  const tool = componentSceneTool({
    store: { loadDocument: async () => ({ scenes: [] }), putScene },
    currentOwner: async () => 'owner',
    onCheckpoint: vi.fn(),
  } as any);
  const input = {
    stageId: 'stage',
    sceneId: 'cards',
    title: 'Cards',
    order: 1,
    templateId: 'teaching-cards',
    templateRevision: 3,
    props: { cards: [{ picture: 'owned-picture', label: 'camel' }] },
  };
  expect(((await tool.execute('call', input)) as any).isError).not.toBe(true);
  const scene = putScene.mock.calls[0][1];
  expect(scene.content.assetSlots).toEqual(remote.assetSlots);
  expect(
    enumerateAssetManifest({ stage: {} as any, scenes: [scene] }).referenceCounts.get(
      'owned-picture',
    ),
  ).toBe(1);
  expect(
    (
      (await tool.execute('call', {
        ...input,
        props: { cards: [{ picture: 42, label: 'camel' }] },
      })) as any
    ).isError,
  ).toBe(true);
});

const sourceUrl = 'https://static.dinoai.ai/resources/example.jpeg';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
  'base64',
);
async function planMediaFixture(currentPlan?: () => { id: string; revision: number } | undefined) {
  const spec = await mocks.spec();
  spec.planVersions = [
    {
      revision: 3,
      value: {
        id: 'food',
        nodes: [{ segments: [{ contentRequirements: `原课图片：${sourceUrl}。` }] }],
      },
    },
  ];
  mocks.spec.mockResolvedValue(spec);
  mocks.fetchMedia.mockImplementation(async () => new Response(png));
  mocks.saveAsset.mockResolvedValue('imported-image');
  mocks.ownedWrite.mockResolvedValue(undefined);
  const putScene = vi.fn();
  const tool: any = componentSceneTool(
    {
      store: { loadDocument: async () => ({ scenes: [] }), putScene },
      currentOwner: async () => 'owner',
      onCheckpoint: vi.fn(),
      fence: vi.fn(),
    } as any,
    currentPlan,
  );
  const input = {
    stageId: 'stage',
    sceneId: 'picture',
    title: 'Apple',
    order: 1,
    templateId: 'teaching-picture',
    templateRevision: 1,
    planSelection: { id: 'food', revision: 3 },
    props: { text: 'apple', imageUrl: sourceUrl, imageDescribe: 'An apple' },
  };
  return { spec, putScene, tool, input };
}
it('imports exact pinned-plan media into the author library, preserves raw input, and reuses owned imports', async () => {
  const { putScene, tool, input } = await planMediaFixture();
  expect((await tool.execute('save', input)).isError).not.toBe(true);
  expect(putScene.mock.calls[0][1].content.props.imageUrl).toBe('imported-image');
  expect(input.props.imageUrl).toBe(sourceUrl);
  expect(mocks.saveAsset).toHaveBeenCalledWith(
    expect.objectContaining({
      ownerId: 'owner',
      stageId: 'stage',
      kind: 'image',
      mimeType: 'image/png',
      fence: expect.any(Function),
    }),
  );
  const save = mocks.saveAsset.mock.calls[0][0];
  await save.fence('transaction');
  expect(mocks.ownedWrite).toHaveBeenCalledWith(
    'transaction',
    'owner',
    'stage',
    expect.any(Function),
  );
  expect((await tool.execute('retry', input)).isError).not.toBe(true);
  expect(mocks.fetchMedia).toHaveBeenCalledOnce();
  expect(mocks.saveAsset).toHaveBeenCalledOnce();
});
it('rejects unlisted URLs and wrong plan revisions before fetching, and explains how to retry missing selection', async () => {
  const { putScene, tool, input } = await planMediaFixture();
  const missing = { ...input, planSelection: undefined };
  const result = await tool.execute('missing', missing);
  expect(result.isError).toBe(true);
  expect((result.content[0] as any).text).toContain('planSelection');
  for (const changed of [
    { ...input, planSelection: { id: 'food', revision: 2 } },
    { ...input, props: { ...input.props, imageUrl: sourceUrl + '?unlisted=true' } },
  ])
    expect((await tool.execute('invalid', changed)).isError).toBe(true);
  expect(mocks.fetchMedia).not.toHaveBeenCalled();
  expect(mocks.saveAsset).not.toHaveBeenCalled();
  expect(putScene).not.toHaveBeenCalled();
});
it('rejects HTML bodies, media kind mismatches, HTTP failures and oversized streaming media without saving a scene', async () => {
  const { spec, putScene, tool, input } = await planMediaFixture();
  mocks.fetchMedia.mockResolvedValueOnce(
    new Response('<html>access denied</html>', { headers: { 'content-type': 'image/png' } }),
  );
  expect((await tool.execute('html', input)).isError).toBe(true);
  mocks.fetchMedia.mockResolvedValueOnce(new Response(Buffer.from('ID3audio')));
  expect((await tool.execute('wrong-kind', input)).isError).toBe(true);
  mocks.fetchMedia.mockResolvedValueOnce(new Response(null, { status: 404 }));
  expect((await tool.execute('not-found', input)).isError).toBe(true);
  spec.assetPolicy = { kinds: { image: 4 } };
  mocks.fetchMedia.mockResolvedValueOnce(new Response(png));
  expect((await tool.execute('too-large', input)).isError).toBe(true);
  expect(mocks.saveAsset).not.toHaveBeenCalled();
  expect(putScene).not.toHaveBeenCalled();
});
it('does not write media or scene after cancellation or a refused asset allocation', async () => {
  const { putScene, tool, input } = await planMediaFixture();
  const abort = new AbortController();
  mocks.fetchMedia.mockImplementationOnce(async () => {
    abort.abort();
    return new Response(png);
  });
  expect((await tool.execute('aborted', input, abort.signal)).isError).toBe(true);
  expect(mocks.saveAsset).not.toHaveBeenCalled();
  mocks.saveAsset.mockRejectedValueOnce(new Error('lease expired'));
  expect((await tool.execute('fenced', input)).isError).toBe(true);
  expect(putScene).not.toHaveBeenCalled();
});
it('rewrites repeated URLs in nested wildcard slots without duplicate allocations', async () => {
  const { spec, putScene, tool, input } = await planMediaFixture();
  const template = spec.templateVersions[0].value;
  template.contentSchema = {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: { type: 'object', properties: { image: { type: 'string' } }, required: ['image'] },
      },
    },
    required: ['cards'],
    additionalProperties: false,
  };
  template.assetSlots = [{ path: '/cards/*/image', kind: 'image' }];
  const response = await tool.execute('nested', {
    ...input,
    props: { cards: [{ image: sourceUrl }, { image: sourceUrl }] },
  });
  expect(response.isError).not.toBe(true);
  expect(putScene.mock.calls[0][1].content.props.cards).toEqual([
    { image: 'imported-image' },
    { image: 'imported-image' },
  ]);
  expect(mocks.saveAsset).toHaveBeenCalledOnce();
});

it('uses registered original bytes from LearnWeave without relying on external CDN access', async () => {
  const { putScene, tool, input } = await planMediaFixture();
  mocks.planMedia.mockResolvedValueOnce(new Response(png));
  expect((await tool.execute('registered-source', input)).isError).not.toBe(true);
  expect(mocks.planMedia).toHaveBeenCalledWith(
    { id: 'food', revision: 3 },
    sourceUrl,
    expect.any(AbortSignal),
  );
  expect(mocks.fetchMedia).not.toHaveBeenCalled();
  expect(putScene.mock.calls[0][1].content.props.imageUrl).toBe('imported-image');
});

it('automatically uses the plan already read by this session when the model omits planSelection', async () => {
  const { putScene, tool, input } = await planMediaFixture(() => ({ id: 'food', revision: 3 }));
  const { planSelection: _, ...withoutSelection } = input;
  expect((await tool.execute('retry-original-call', withoutSelection)).isError).not.toBe(true);
  expect(putScene.mock.calls[0][1].content.props.imageUrl).toBe('imported-image');
});
