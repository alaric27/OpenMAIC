import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getProductionStandards,
  compiledStandards,
  resolveStandard,
  assertManifestStandards,
} from '@/extensions/learnweave/standards-client';
import { buildActivity } from '@/extensions/learnweave/templates';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('published LearnWeave standards client', () => {
  it('reads fresh published types and versions without a producer deployment', async () => {
    const initial = compiledStandards();
    const custom = { ...structuredClone(initial.entries[0]), id: 'teaching.from-page', version: 2 };
    custom.schema.properties.templateId.const = custom.id;
    custom.schema.properties.templateVersion.const = 2;
    const next = {
      ...initial,
      entries: [...initial.entries, custom],
      versions: [...initial.versions, custom],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => initial })
      .mockResolvedValueOnce({ ok: true, json: async () => next });
    vi.stubGlobal('fetch', fetch);
    expect(() => resolveStandard(initial, custom.id)).toThrow('尚未发布');
    await getProductionStandards();
    const updated = await getProductionStandards();
    expect(resolveStandard(updated, custom.id).version).toBe(2);
    const built = buildActivity(
      {
        stageId: 'course',
        activityId: 'new',
        title: 'new',
        templateId: custom.id,
        contentRef: 'page',
        order: 0,
        expectedRevision: 0,
      },
      custom,
    );
    expect(built.activity.standard?.id).toBe(custom.id);
    expect(built.activity.templateVersion).toBe(2);
    const manifest = { schemaVersion: 1 as const, revision: 1, activities: [built.activity] };
    expect(() => assertManifestStandards(manifest, updated)).not.toThrow();
    built.activity.standard!.title = 'tampered';
    expect(() => assertManifestStandards(manifest, updated)).toThrow('snapshot mismatch');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('never silently falls back to compiled IDs when the authoritative service is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(getProductionStandards()).rejects.toThrow('不会退回旧的模板目录');
  });
});
