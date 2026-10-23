import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  provider: vi.fn(),
  ownerFence: vi.fn(),
}));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: mocks.provider,
}));
vi.mock('@/lib/persistence/owner-merges', async (actual) => ({
  ...(await actual<object>()),
  fenceOwnerWrite: mocks.ownerFence,
}));
import { assertOwnedWrite } from '@/extensions/learnweave/adapter';
import { buildLearnWeaveTools } from '@/extensions/learnweave';
import type { ToolDeps, Queryable } from '@/extensions/learnweave/adapter';
import type { NextRequest } from 'next/server';
import { exportBundle } from '@/extensions/learnweave/export';

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ownerFence.mockResolvedValue(undefined);
});
describe('LearnWeave host boundary', () => {
  it('disabled tools and Bundle do not access persistence or TTS', async () => {
    vi.stubEnv('LEARNWEAVE_EXTENSION_ENABLED', 'false');
    expect(await buildLearnWeaveTools({} as ToolDeps)).toEqual([]);
    expect((await exportBundle({} as NextRequest, 'stage')).status).toBe(404);
    expect(mocks.provider).not.toHaveBeenCalled();
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
    await assertOwnedWrite(tx as unknown as Queryable, 'owner', 'stage', fence);
    expect(order).toEqual(['owner', 'lease', 'row']);
    expect(fence).toHaveBeenCalledWith(tx);
    expect(tx.query).toHaveBeenCalledWith(expect.stringContaining('FOR SHARE'), ['stage', 'owner']);
    tx.query.mockResolvedValueOnce({ rows: [] });
    await expect(
      assertOwnedWrite(tx as unknown as Queryable, 'owner', 'stage', fence),
    ).rejects.toThrow('no longer owned');
    fence.mockRejectedValueOnce(new Error('expired lease'));
    tx.query.mockClear();
    await expect(
      assertOwnedWrite(tx as unknown as Queryable, 'owner', 'stage', fence),
    ).rejects.toThrow('expired lease');
    expect(tx.query).not.toHaveBeenCalled();
  });
});
