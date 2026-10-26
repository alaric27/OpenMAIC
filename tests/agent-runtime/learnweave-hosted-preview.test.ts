import { beforeEach, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  spec: vi.fn(),
  create: vi.fn(),
  thumbnail: vi.fn(),
  provider: vi.fn(),
  identify: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock('@/extensions/learnweave/client', () => ({
  productionSpec: mocks.spec,
  createComponentPreview: mocks.create,
  componentPreviewThumbnail: mocks.thumbnail,
  ProductionError: class extends Error {
    constructor(
      message: string,
      readonly status = 422,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/extensions/learnweave/adapter', () => ({
  getServerPersistenceProvider: mocks.provider,
  assetPrincipalForOwner: (owner: string) => owner,
}));
import {
  hostedPreview,
  previewAsset,
  hostedThumbnail,
} from '@/extensions/learnweave/components/hosted-previews';
const body = {
  mode: 'edit',
  content: {
    type: 'component',
    componentRef: { id: 'future-cards', version: '2' },
    props: { cards: [{ picture: 'owned-picture' }] },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.spec.mockResolvedValue({
    templateVersions: [
      {
        value: {
          sceneType: 'component',
          componentRef: body.content.componentRef,
          contentSchema: { type: 'object' },
          assetSlots: [{ path: '/cards/*/picture', kind: 'image' }],
        },
      },
    ],
  });
  mocks.identify.mockImplementation(async (owner, id) =>
    owner === 'author-a' && id === 'owned-picture'
      ? { mime: 'image/png', revision: 1, byteLength: 9 }
      : null,
  );
  mocks.resolve.mockResolvedValue({
    mime: 'image/png',
    revision: 1,
    bytes: Buffer.from('fixture'),
  });
  mocks.provider.mockResolvedValue({
    assetStore: { identify: mocks.identify, resolve: mocks.resolve },
  });
  mocks.create.mockResolvedValue({
    id: crypto.randomUUID(),
    token: 'scoped-token',
    url: 'http://127.0.0.1:5173/#component-preview=fixture',
    expiresAt: Date.now() + 60000,
  });
  mocks.thumbnail.mockResolvedValue(Buffer.from('<svg/>'));
});
it('generic future components need no installed renderer; grant only owned declared assets', async () => {
  const hosted = await hostedPreview('author-a', 'http://localhost:3000', body),
    input = mocks.create.mock.calls[0]![0];
  expect(input.assets).toEqual([
    { id: 'owned-picture', kind: 'image', mimeType: 'image/png', revision: '1' },
  ]);
  expect(input.sourceTicket).toMatch(/^[a-f0-9]{64}$/);
  expect(hosted.assetSlots).toEqual([{ path: '/cards/*/picture', kind: 'image' }]);
  expect((await previewAsset(input.sourceTicket, 'owned-picture')).bytes).toEqual(
    Buffer.from('fixture'),
  );
  await expect(previewAsset(input.sourceTicket, 'other-picture')).rejects.toThrow(/不存在/);
  expect(mocks.resolve).toHaveBeenCalledWith('author-a', 'owned-picture');
});
it('thumbnail requests cannot cross owners and stale assets cannot reuse the grant', async () => {
  const hosted = await hostedPreview('author-a', 'http://localhost:3000', body),
    input = mocks.create.mock.calls[0]![0];
  await expect(hostedThumbnail('another-author', hosted.id)).rejects.toThrow(/不存在/);
  expect(mocks.thumbnail).not.toHaveBeenCalled();
  expect(await hostedThumbnail('author-a', hosted.id)).toEqual(Buffer.from('<svg/>'));
  mocks.identify.mockResolvedValue({ mime: 'image/png', revision: 2, byteLength: 9 });
  await expect(previewAsset(input.sourceTicket, 'owned-picture')).rejects.toThrow(/改变/);
});
it('foreign or unsaved media stay ungranted so incomplete content can still be edited', async () => {
  await hostedPreview('author-b', 'http://localhost:3000', body);
  expect(mocks.create.mock.calls[0]![0].assets).toEqual([]);
  expect(mocks.resolve).not.toHaveBeenCalled();
});
