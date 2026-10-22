import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  identify: vi.fn(),
  provider: vi.fn(),
  ownerFence: vi.fn(),
  audio: vi.fn(),
}));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: mocks.provider,
}));
vi.mock('@/lib/persistence/owner-merges', async (actual) => ({
  ...(await actual<object>()),
  fenceOwnerWrite: mocks.ownerFence,
}));
vi.mock('@/extensions/learnweave/media', () => ({ promptAudio: mocks.audio }));
import { assertOwnedAssets, assertOwnedWrite, promptAudio } from '@/extensions/learnweave/adapter';
import { buildLearnWeaveTools } from '@/extensions/learnweave';
import { exportBundle } from '@/extensions/learnweave/export';

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.provider.mockResolvedValue({ assetStore: { identify: mocks.identify } });
  mocks.ownerFence.mockResolvedValue(undefined);
});
describe('LearnWeave host boundary', () => {
  it('disabled tools and Bundle do not access persistence or TTS', async () => {
    vi.stubEnv('LEARNWEAVE_EXTENSION_ENABLED', 'false');
    expect(await buildLearnWeaveTools({} as any)).toEqual([]);
    expect((await exportBundle({} as any, 'stage')).status).toBe(404);
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.audio).not.toHaveBeenCalled();
  });
  it('existing audio validates ownership and MIME without invoking TTS', async () => {
    mocks.identify.mockResolvedValueOnce({ mime: 'audio/mpeg' });
    await assertOwnedAssets('owner', [{ id: 'audio', kind: 'audio' }]);
    expect(mocks.identify).toHaveBeenCalledWith(expect.anything(), 'audio');
    expect(mocks.audio).not.toHaveBeenCalled();
    mocks.identify.mockResolvedValueOnce(null);
    await expect(assertOwnedAssets('owner', [{ id: 'foreign', kind: 'image' }])).rejects.toThrow(
      'owned',
    );
    mocks.identify.mockResolvedValueOnce({ mime: 'image/png' });
    await expect(assertOwnedAssets('owner', [{ id: 'wrong-kind', kind: 'audio' }])).rejects.toThrow(
      'expected type',
    );
  });
  it('checks owner and lease fences before acquiring the stage owner row lock', async () => {
    const order: string[] = [];
    mocks.ownerFence.mockImplementationOnce(async () => {
      order.push('owner');
    });
    const tx = {
      query: vi.fn(async () => {
        order.push('row');
        return { rows: [{ stage_id: 'stage' }] };
      }),
    };
    const fence = vi.fn(async () => {
      order.push('lease');
    });
    await assertOwnedWrite(tx as any, 'owner', 'stage', fence);
    expect(order).toEqual(['owner', 'lease', 'row']);
    expect(fence).toHaveBeenCalledWith(tx);
    expect(tx.query).toHaveBeenCalledWith(expect.stringContaining('FOR SHARE'), ['stage', 'owner']);
    tx.query.mockResolvedValueOnce({ rows: [] });
    await expect(assertOwnedWrite(tx as any, 'owner', 'stage', fence)).rejects.toThrow(
      'no longer owned',
    );
    fence.mockRejectedValueOnce(new Error('expired lease'));
    tx.query.mockClear();
    await expect(assertOwnedWrite(tx as any, 'owner', 'stage', fence)).rejects.toThrow(
      'expired lease',
    );
    expect(tx.query).not.toHaveBeenCalled();
  });
  it('invokes the optional TTS adapter only on an explicit audio-generation request', async () => {
    mocks.audio.mockResolvedValue('saved-audio');
    const signal = new AbortController().signal,
      fence = async () => {};
    expect(await promptAudio('apple', 'stage', 'owner', signal, fence)).toBe('saved-audio');
    expect(mocks.audio).toHaveBeenCalledWith('apple', 'stage', 'owner', signal, fence);
  });
});
