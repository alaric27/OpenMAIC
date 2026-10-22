import { describe, expect, it } from 'vitest';
import { productionSpec, templateSchema } from '@/extensions/learnweave/contracts/generated';
import { Value } from 'typebox/value';
import { buildActivity, type ActivityInput } from '@/extensions/learnweave/templates';
import { checkedManifest, bindingFingerprint } from '@/extensions/learnweave/validate';
import type { CourseDocument } from '@/lib/server/agent-runtime/course-tools';

const input = (): ActivityInput => ({
  stageId: 'course',
  activityId: 'apple',
  templateId: 'practice.listen-image',
  title: 'Listen & choose',
  order: 0,
  expectedRevision: 0,
  audioSrc: 'audio-id',
  options: [
    { value: 'A', label: 'apple', imageSrc: 'apple-image' },
    { value: 'B', label: 'bread', imageSrc: 'bread-image' },
  ],
  answer: 'A',
  hints: ['Listen again'],
  maxAttempts: 3,
});
function built() {
  const result = buildActivity(input());
  const document = {
    stage: { id: 'course', name: 'Food', createdAt: 1, updatedAt: 1 },
    scenes: result.scenes,
  } as CourseDocument;
  const manifest = { schemaVersion: 1 as const, revision: 1, activities: [result.activity] };
  return { document, manifest };
}
describe('LearnWeave template generation', () => {
  it('creates native image/audio references and an explicit quiz binding with stable identities', () => {
    const a = built();
    const b = built();
    expect(a.document.scenes.map((s) => s.id)).toEqual(b.document.scenes.map((s) => s.id));
    expect(checkedManifest(a.manifest, a.document)).toEqual(a.manifest);
    expect(a.document.scenes[0].content.type).toBe('slide');
    expect(a.document.scenes[1].content.type).toBe('quiz');
    expect(JSON.stringify(a.document)).toContain('/api/persistence/assets/apple-image/content');
    expect(a.manifest.activities[0].optionImageElementIds).toEqual({
      A: 'option-0',
      B: 'option-1',
    });
  });
  it('supports picture-word without listening audio and never guesses image bindings', () => {
    const r = buildActivity({
      ...input(),
      templateId: 'practice.image-word',
      imageSrc: 'apple-image',
      audioSrc: undefined,
    });
    expect(r.activity.imageElementId).toBe('stem-image');
    expect(r.activity.mediaElementId).toBeUndefined();
    expect(() =>
      buildActivity({
        ...input(),
        options: input().options!.map((o) => ({ ...o, imageSrc: undefined })),
      }),
    ).toThrow('image');
    expect(() => buildActivity({ ...input(), audioSrc: 'https://foreign.example/a.mp3' })).toThrow(
      'saved',
    );
  });
  it('detects changed answers and deleted media while tolerating layout-only edits', () => {
    const { document, manifest } = built();
    const before = bindingFingerprint(manifest, document);
    if (document.scenes[0].content.type !== 'slide' || document.scenes[1].content.type !== 'quiz')
      throw new Error('fixture');
    document.scenes[0].content.canvas.elements[0].left += 10;
    expect(bindingFingerprint(manifest, document)).toBe(before);
    document.scenes[1].content.questions[0].answer = ['B'];
    expect(bindingFingerprint(manifest, document)).not.toBe(before);
    document.scenes[0].content.canvas.elements = [];
    expect(() => checkedManifest(manifest, document)).toThrow('binding');
  });
  it('retains its fingerprint after JSONB changes object key order', () => {
    const { document, manifest } = built();
    const reorder = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reorder);
      if (value && typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value)
            .reverse()
            .map(([key, item]) => [key, reorder(item)]),
        );
      return value;
    };
    expect(
      bindingFingerprint(
        reorder(manifest) as typeof manifest,
        reorder(document) as typeof document,
      ),
    ).toBe(bindingFingerprint(manifest, document));
  });
});

describe('LearnWeave sentence-expression production standard', () => {
  it('builds the shared example on an existing native slide, retaining task data and stable IDs', () => {
    const { document } = built();
    const example = productionSpec.activities['teaching.sentence-expression'].example;
    const args = {
      ...JSON.parse(JSON.stringify(example)),
      stageId: 'course',
      activityId: example.id,
      order: 0,
      expectedRevision: 0,
      contentRef: document.scenes[0].id,
    };
    const first = buildActivity(args);
    expect(Value.Check(templateSchema, first.activity)).toBe(true);
    expect(first.scenes).toEqual([]);
    expect(first.activity.data).toEqual(example.data);
    expect(first.activity.goal).toEqual(example.goal);
    expect(buildActivity(args).activity.id).toBe(first.activity.id);
    const manifest = { schemaVersion: 1 as const, revision: 1, activities: [first.activity] };
    expect(checkedManifest(manifest, document)).toEqual(manifest);
    const old = bindingFingerprint(manifest, document);
    if (first.activity.templateId !== 'teaching.sentence-expression') throw new Error('fixture');
    (first.activity.data as Record<string, unknown>).sentenceFrame = 'I can ___.';
    expect(bindingFingerprint(manifest, document)).not.toBe(old);
  });
  it('rejects missing task data and unsupported practice rather than falling back', () => {
    const example = productionSpec.activities['teaching.sentence-expression'].example;
    const args = {
      ...JSON.parse(JSON.stringify(example)),
      stageId: 'course',
      activityId: example.id,
      order: 0,
      expectedRevision: 0,
    };
    expect(() => buildActivity({ ...args, data: undefined })).toThrow('Activity data');
    expect(() => buildActivity({ ...input(), templateId: 'practice.unknown' as any })).toThrow(
      'Unsupported practice',
    );
  });
});
