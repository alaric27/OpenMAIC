import { createHash } from 'node:crypto';
import { validateScene } from '@openmaic/dsl';
import type { Scene } from '@openmaic/dsl';
import { ActivityInputError } from './errors';
import { Value } from 'typebox/value';
import {
  templateSchema,
  templateInputProperties,
  type TemplateActivity,
  type ProducerInput,
  type TemplateStandard,
} from './contracts/generated';

import { productionInputIssue, templateContentRule } from './contracts/template-bindings';
export type ActivityInput = Omit<ProducerInput, 'hints' | 'maxAttempts'> &
  Partial<Pick<ProducerInput, 'hints' | 'maxAttempts'>>;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function sourceAssetId(src: string) {
  const id = /^[A-Za-z0-9_-]{1,160}$/.test(src)
    ? src
    : /^\/api\/persistence\/assets\/([A-Za-z0-9_-]{1,160})\/content$/.exec(src)?.[1];
  if (!id)
    throw new ActivityInputError(
      'INVALID_ASSET_REFERENCE',
      'Use a saved OpenMAIC asset ID or /api/persistence/assets/<id>/content. For listening audio, use a same-course /api/classroom-media/ reference, or omit audioSrc and supply promptText. Do not retry the same unsupported URL.',
    );
  return id;
}
const ref = (src: string) => `/api/persistence/assets/${sourceAssetId(src)}/content`;
export function buildActivity(
  input: ActivityInput,
  standard?: TemplateStandard,
): {
  activity: TemplateActivity;
  scenes: Scene[];
} {
  const activity = {
    id: input.activityId,
    title: input.title,
    templateId: input.templateId,
    templateVersion: standard?.version ?? 1,
    ...(standard ? { standard: structuredClone(standard) } : {}),
    contentRef: input.contentRef || '',
    hints: input.hints || [],
    maxAttempts:
      input.maxAttempts ??
      standard?.schema.properties?.maxAttempts?.default ??
      templateInputProperties.maxAttempts.default,
    ...(input.instructions ? { instructions: input.instructions } : {}),
    ...(input.goal ? { goal: input.goal } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.data ? { data: input.data } : {}),
  } as TemplateActivity;
  const rule = templateContentRule(input.templateId, standard);
  const inputIssue = productionInputIssue(rule, input, true);
  if (inputIssue) throw new ActivityInputError('INVALID_ACTIVITY_PARAMETERS', inputIssue);
  const checked = () => {
    const { standard: _snapshot, ...body } = activity;
    const schema = standard?.schema || templateSchema;
    const candidate = standard ? body : activity;
    if (!Value.Check(schema, candidate)) {
      const fields = [...Value.Errors(schema, candidate)]
        .slice(0, 8)
        .map((error) => error.instancePath || '/');
      throw new ActivityInputError(
        'INVALID_ACTIVITY_PARAMETERS',
        `Activity data does not match the versioned LearnWeave standard: ${fields.join(', ')}`,
      );
    }
  };
  if (rule.builder === 'existing-slide') {
    if (input.mediaElementId) activity.mediaElementId = input.mediaElementId;
    checked();
    return { activity, scenes: [] };
  }
  if (rule.builder !== 'single-choice' || !rule.choice)
    throw new Error('Unsupported content builder');
  if (!Value.Check(templateInputProperties.options, input.options))
    throw new ActivityInputError('INVALID_ACTIVITY_PARAMETERS', 'Invalid choice options');
  const scenes = buildSingleChoice(input, activity, rule.choice);
  checked();
  return { activity, scenes };
}

/** Native DSL layout capability shared by all single-choice activities. */
function buildSingleChoice(
  input: ActivityInput,
  activity: TemplateActivity,
  choice: NonNullable<ReturnType<typeof templateContentRule>['choice']>,
): Scene[] {
  const options = input.options!;
  const base =
    'lw-' +
    createHash('sha256')
      .update(input.stageId + ':' + input.activityId)
      .digest('hex')
      .slice(0, 20);
  activity.contentRef = base + '-page';
  activity.quizSceneId = base + '-quiz';
  activity.questionId = 'q1';
  const elements: Record<string, unknown>[] = [];
  const text = (id: string, label: string, left: number, top: number, width: number) =>
    elements.push({
      id,
      type: 'text',
      left,
      top,
      width,
      height: 65,
      rotate: 0,
      content: `<p style="font-size:36px;text-align:center">${escape(label)}</p>`,
      defaultFontName: 'Arial',
      defaultColor: '#20382f',
    });
  text('title', input.title, 60, 20, 880);
  if (choice.stimulus === 'audio') {
    activity.mediaElementId = 'prompt-audio';
    elements.push({
      id: 'prompt-audio',
      type: 'audio',
      left: 460,
      top: 460,
      width: 60,
      height: 60,
      rotate: 0,
      fixedRatio: true,
      color: '#527768',
      loop: false,
      autoplay: false,
      src: ref(input.audioSrc!),
    });
  } else if (choice.stimulus === 'image') {
    activity.imageElementId = 'stem-image';
    elements.push({
      id: 'stem-image',
      type: 'image',
      left: 350,
      top: 105,
      width: 300,
      height: 275,
      rotate: 0,
      fixedRatio: true,
      src: ref(input.imageSrc!),
    });
  } else throw new Error('Unsupported stimulus capability');
  if (choice.options === 'image') {
    activity.optionImageElementIds = Object.create(null) as Record<string, string>;
    options.forEach((o, i) => {
      const id = `option-${i}`;
      activity.optionImageElementIds![o.value] = id;
      const width = Math.min(230, 850 / options.length);
      const left = 75 + (i * 850) / options.length;
      elements.push({
        id,
        type: 'image',
        left,
        top: 145,
        width,
        height: 230,
        rotate: 0,
        fixedRatio: true,
        src: ref(o.imageSrc!),
      });
      text(`label-${i}`, o.value, left, 395, width);
    });
  } else if (choice.options === 'text') {
    options.forEach((o, i) =>
      text(`label-${i}`, o.label, 65 + (i * 870) / options.length, 420, 850 / options.length),
    );
  } else throw new Error('Unsupported option presentation capability');
  const scenes = [
    {
      id: activity.contentRef,
      stageId: input.stageId,
      type: 'slide',
      title: input.title,
      order: input.order * 2,
      actions: [],
      content: {
        type: 'slide',
        canvas: {
          id: activity.contentRef,
          viewportSize: 1000,
          viewportRatio: 0.5625,
          theme: {
            backgroundColor: '#fffdf6',
            themeColors: ['#527768'],
            fontColor: '#20382f',
            fontName: 'Arial',
          },
          elements,
        },
      },
    },
    {
      id: activity.quizSceneId,
      stageId: input.stageId,
      type: 'quiz',
      title: input.title,
      order: input.order * 2 + 1,
      actions: [],
      content: {
        type: 'quiz',
        questions: [
          {
            id: 'q1',
            type: choice.questionType,
            question: choice.prompt,
            options: options.map(({ value, label }) => ({ value, label })),
            answer: [input.answer],
            hasAnswer: true,
          },
        ],
      },
    },
  ] as Scene[];
  for (const scene of scenes)
    if (!validateScene(scene).valid)
      throw new Error('Generated activity does not satisfy the native DSL');
  return scenes;
}
