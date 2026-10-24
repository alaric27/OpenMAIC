import { beforeEach, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ task: vi.fn(), store: vi.fn() }));
vi.mock('@/lib/server/agent-runtime/pending-media', () => ({ getPendingMediaTask: m.task }));
vi.mock('@/lib/server/agent-runtime/store', () => ({ getAgentSessionStore: m.store }));
import { componentMediaTool } from '@/extensions/learnweave/components/media';
beforeEach(() => {
  vi.clearAllMocks();
  m.task.mockReturnValue(undefined);
  m.store.mockResolvedValue({
    getSession: async () => ({ ownerId: 'owner' }),
    readEventsAfter: async () => [],
  });
});
const deps = { sessionId: 'session', currentOwner: async () => 'owner' } as any;
it('resolves native video completion only for the current stage and session', async () => {
  m.task.mockReturnValue({
    stageId: 'stage',
    sessionId: 'session',
    status: 'done',
    src: 'ast_video',
  });
  const r = await componentMediaTool(deps).execute('call', { stageId: 'stage', ref: 'gen_vid_x' });
  expect(r.details).toMatchObject({ status: 'done', src: 'ast_video' });
});
it('reads durable completion after the process-local registry is gone', async () => {
  m.store.mockResolvedValue({
    getSession: async () => ({ ownerId: 'owner' }),
    readEventsAfter: async () => [
      {
        id: 1,
        type: 'media_ready',
        data: { stageId: 'stage', ref: 'gen_vid_x', status: 'done', src: 'ast_video' },
      },
    ],
  });
  const r = await componentMediaTool(deps).execute('call', { stageId: 'stage', ref: 'gen_vid_x' });
  expect(r.details).toMatchObject({ status: 'done', src: 'ast_video' });
});
it('rejects another session or owner and never treats a missing job as a saved asset', async () => {
  m.task.mockReturnValue({ stageId: 'stage', sessionId: 'other', status: 'done', src: 'private' });
  expect(
    (
      (await componentMediaTool(deps).execute('call', {
        stageId: 'stage',
        ref: 'gen_vid_x',
      })) as any
    ).isError,
  ).toBe(true);
  m.store.mockResolvedValue({ getSession: async () => ({ ownerId: 'other' }) });
  expect(
    (
      (await componentMediaTool(deps).execute('call', {
        stageId: 'stage',
        ref: 'gen_vid_x',
      })) as any
    ).isError,
  ).toBe(true);
});

it('does not report an unobservable previous job as generating forever', async () => {
  m.store.mockResolvedValue({
    getSession: async () => ({ ownerId: 'owner' }),
    readEventsAfter: async () => [
      {
        id: 1,
        type: 'tool_execution_end',
        data: {
          toolName: 'generate_video',
          result: { details: { stageId: 'stage', ref: 'gen_vid_x' } },
        },
      },
    ],
  });
  const r = await componentMediaTool(deps).execute('call', { stageId: 'stage', ref: 'gen_vid_x' });
  expect(r.details).toMatchObject({ status: 'unavailable', ref: 'gen_vid_x' });
  expect((r as any).isError).toBe(true);
});
