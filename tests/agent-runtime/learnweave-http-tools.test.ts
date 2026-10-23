import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ specification: vi.fn() }));
vi.mock('@/extensions/learnweave/adapter', () => ({
  wrapTools: async (tools: unknown[]) => tools,
  runStageMutation: async (_signal: unknown, fn: () => unknown) => fn(),
}));
vi.mock('@/extensions/learnweave/production', () => ({
  productionSpec: mocks.specification,
  readCourse: vi.fn(),
  saveCourse: vi.fn(),
  produceBundle: vi.fn(),
  ProductionError: class extends Error {},
}));
import { buildLearnWeaveTools } from '@/extensions/learnweave';
import type { ToolDeps } from '@/extensions/learnweave/adapter';
import { validateToolArguments } from '@earendil-works/pi-ai';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe('service-provided authoring schema', () => {
  it('does not need the service when the extension is disabled', async () => {
    vi.stubEnv('LEARNWEAVE_EXTENSION_ENABLED', 'false');
    expect(await buildLearnWeaveTools({} as ToolDeps)).toEqual([]);
    expect(mocks.specification).not.toHaveBeenCalled();
  });
  it('registers the current service schema for the write tool', async () => {
    vi.stubEnv('LEARNWEAVE_EXTENSION_ENABLED', 'true');
    const schema = {
      type: 'object',
      properties: { newServiceField: { type: 'string' } },
      required: ['newServiceField'],
    };
    mocks.specification.mockResolvedValueOnce({ authoringSchema: schema });
    const tools = await buildLearnWeaveTools({} as ToolDeps);
    const save = tools.find((tool) => tool.name === 'lw_save_course')!;
    expect((save.parameters as any).properties.manifest).toEqual(schema);
    expect(
      validateToolArguments(save, {
        type: 'toolCall',
        id: 'save',
        name: 'lw_save_course',
        arguments: {
          stageId: 'stage',
          expectedRevision: 0,
          manifest: { newServiceField: 'accepted' },
        },
      }),
    ).toMatchObject({ manifest: { newServiceField: 'accepted' } });
    expect(() =>
      validateToolArguments(save, {
          type: 'toolCall',
        id: 'invalid',
        name: 'lw_save_course',
        arguments: { stageId: 'stage', expectedRevision: 0, manifest: {} },
      }),
    ).toThrow();
  });
  it('keeps native runner registration possible during an outage without exposing stale write rules', async () => {
    vi.stubEnv('LEARNWEAVE_EXTENSION_ENABLED', 'true');
    mocks.specification.mockRejectedValueOnce(new Error('service unavailable'));
    const tools = await buildLearnWeaveTools({} as ToolDeps);
    expect(tools.map((tool) => tool.name)).toEqual(['lw_read_activities', 'lw_read_course_plan']);
  });
});
