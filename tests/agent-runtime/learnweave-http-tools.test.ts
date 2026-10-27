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
  it('reads hierarchical plans using the authoritative Segment activity sequence', async () => {
    vi.stubEnv('LEARNWEAVE_EXTENSION_ENABLED', 'true');
    const template = { revision: 4, value: { id: 'teaching-picture' } };
    const selected = {
      revision: 2,
      value: { id: 'food', schemaVersion: 2, nodes: [{ id: 'apple', segments: [{ id: 'learn', templateId: 'teaching-picture', templateRevision: 4 }, { id: 'check', templateId: 'teaching-picture', templateRevision: 4 }] }] },
      activities: ['learn', 'check'].map((segmentId, i) => ({ nodeId: 'apple', segmentId, configuration: { id: `segment-1-${i + 1}`, templateId: 'teaching-picture', templateRevision: 4 } })),
    };
    mocks.specification.mockResolvedValue({ authoringSchema: {}, plans: [selected], planVersions: [selected], templateVersions: [template] });
    const tools = await buildLearnWeaveTools({} as ToolDeps);
    const read = tools.find(t => t.name === 'lw_read_course_plan')!;
    const response = await read.execute('read', { planId: 'food', revision: 2 }) as any;
    expect(response.details.plan.value.nodes).toHaveLength(1);
    expect(response.details.activities.map((a: any) => a.configuration.id)).toEqual(['segment-1-1', 'segment-1-2']);
    expect(response.details.templates).toEqual([template, template]);
    expect(response.details.instruction).toContain('nodeId and segmentId');
  });
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
