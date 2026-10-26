import { beforeEach, it, expect, vi } from 'vitest';
import { contentSchema, assetSlots } from './component-contract-fixtures';
const mocks = vi.hoisted(() => ({ spec: vi.fn(), provider: vi.fn() }));
vi.mock('@/extensions/learnweave/client', () => ({ productionSpec: mocks.spec }));
vi.mock('@/extensions/learnweave/adapter', () => ({
  runStageMutation: async (_s: unknown, fn: () => unknown) => fn(),
  getServerPersistenceProvider: mocks.provider,
  assetPrincipalForOwner: (o: string) => o,
}));
import { componentSceneTool } from '@/extensions/learnweave/components/production';
import { validateAppScene } from '@/lib/document-store/validators';
import { enumerateAssetManifest } from '@openmaic/dsl';
beforeEach(() => {
  vi.clearAllMocks();
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
