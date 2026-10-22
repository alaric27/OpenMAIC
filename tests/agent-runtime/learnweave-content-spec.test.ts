import { describe, expect, it, vi } from 'vitest';

// Simulate a future LearnWeave contract sync, without modifying producer code.
vi.mock('@/extensions/learnweave/contracts/generated', async (original) => {
  const actual = await original<typeof import('@/extensions/learnweave/contracts/generated')>();
  const templateSchema = structuredClone(actual.templateSchema) as any;
  templateSchema.anyOf[0].properties.templateId.anyOf.push({
    type: 'string',
    const: 'practice.test-audio-text',
  });
  const manifestSchema = structuredClone(actual.manifestSchema) as any;
  manifestSchema.properties.activities.items = templateSchema;
  const rule = structuredClone(actual.TEMPLATE_CONTENT_SPEC['practice.listen-image']);
  return {
    ...actual,
    templateSchema,
    manifestSchema,
    TEMPLATE_CONTENT_SPEC: {
      ...actual.TEMPLATE_CONTENT_SPEC,
      'practice.test-audio-text': {
        ...rule,
        bindings: [{ field: 'mediaElementId', kind: 'audio' }],
        choice: {
          ...rule.choice,
          options: 'text',
          minOptions: 3,
          maxOptions: 4,
          prompt: 'Choose the word you hear.',
        },
      },
    },
  };
});
import { buildActivity, type ActivityInput } from '@/extensions/learnweave/templates';
import { checkedManifest } from '@/extensions/learnweave/validate';
import type { CourseDocument } from '@/extensions/learnweave/adapter';

const input = (): ActivityInput => ({
  stageId: 'course',
  activityId: 'new-kind',
  templateId: 'practice.test-audio-text' as ActivityInput['templateId'],
  title: 'Choose',
  order: 0,
  expectedRevision: 0,
  audioSrc: 'saved-audio',
  answer: 'A',
  options: ['A', 'B', 'C'].map((value) => ({ value, label: value })),
  hints: [],
  maxAttempts: 3,
});
describe('shared specification drives producer capabilities', () => {
  it('builds and validates a new ID combining audio stimulus with text choices using only the supplied contract', () => {
    const built = buildActivity(input());
    expect(built.activity.mediaElementId).toBe('prompt-audio');
    expect(built.activity.optionImageElementIds).toBeUndefined();
    const quiz = built.scenes.find((s) => s.content.type === 'quiz')!;
    if (quiz.content.type !== 'quiz') throw new Error('fixture');
    expect(quiz.content.questions[0].question).toBe('Choose the word you hear.');
    const doc = {
      stage: { id: 'course', name: 'Choose', createdAt: 1, updatedAt: 1 },
      scenes: built.scenes,
    } as CourseDocument;
    const manifest = { schemaVersion: 1, revision: 1, activities: [built.activity] };
    expect(checkedManifest(manifest, doc)).toEqual(manifest);
    quiz.content.questions[0].answer = ['absent'];
    expect(() => checkedManifest(manifest, doc)).toThrow('invalid question or answer');
  });
  it('uses changed option bounds from the shared spec in the builder and manifest validator', () => {
    expect(() => buildActivity({ ...input(), options: input().options!.slice(0, 2) })).toThrow(
      '3–4',
    );
    expect(() =>
      buildActivity({
        ...input(),
        options: ['A', 'B', 'C', 'D', 'E'].map((value) => ({ value, label: value })),
      }),
    ).toThrow('3–4');
    const built = buildActivity(input());
    const quiz = built.scenes[1];
    if (quiz.content.type !== 'quiz') throw new Error('fixture');
    quiz.content.questions[0].options!.pop();
    const doc = {
      stage: { id: 'course', name: 'Choose', createdAt: 1, updatedAt: 1 },
      scenes: built.scenes,
    } as CourseDocument;
    expect(() =>
      checkedManifest({ schemaVersion: 1, revision: 1, activities: [built.activity] }, doc),
    ).toThrow('3–4');
  });
});
