import { createHash } from 'node:crypto';
import { validateScene } from '@openmaic/dsl';
import type { Scene } from '@openmaic/dsl';
import type { TemplateActivity } from './contracts/generated';

export interface ActivityInput {
  stageId: string; activityId: string; templateId: TemplateActivity['templateId']; title: string; order: number;
  expectedRevision: number; contentRef?: string; mediaElementId?: string;
  promptText?: string; audioSrc?: string; imageSrc?: string; answer?: string;
  options?: { value: string; label: string; imageSrc?: string }[];
  hints?: string[]; instructions?: string; maxAttempts?: number;
}
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function sourceAssetId(src: string) {
  const id = /^[A-Za-z0-9_-]{1,160}$/.test(src) ? src : /^\/api\/persistence\/assets\/([A-Za-z0-9_-]{1,160})\/content$/.exec(src)?.[1];
  if (!id) throw new Error('Use a saved OpenMAIC asset id; external and temporary URLs are not accepted');
  return id;
}
const ref = (src: string) => `/api/persistence/assets/${sourceAssetId(src)}/content`;
export function buildActivity(input: ActivityInput): { activity: TemplateActivity; scenes: Scene[] } {
  const activity: TemplateActivity = { id: input.activityId, title: input.title, templateId: input.templateId, templateVersion: 1, contentRef: input.contentRef || '', hints: input.hints || [], maxAttempts: input.maxAttempts || 3, ...(input.instructions ? { instructions: input.instructions } : {}) };
  if (!input.templateId.startsWith('practice.')) {
    if (!input.contentRef) throw new Error('Teaching/media templates must name an existing contentRef');
    if (input.mediaElementId) activity.mediaElementId = input.mediaElementId;
    return { activity, scenes: [] };
  }
  const options = input.options;
  if (!options || options.length < 2 || options.length > 6 || new Set(options.map((o) => o.value)).size !== options.length || !options.some((o) => o.value === input.answer)) throw new Error('Supply 2–6 unique options and one matching answer');
  const base = 'lw-' + createHash('sha256').update(input.stageId + ':' + input.activityId).digest('hex').slice(0, 20);
  activity.contentRef = base + '-page';
  activity.quizSceneId = base + '-quiz';
  activity.questionId = 'q1';
  const elements: Record<string, unknown>[] = [];
  const text = (id: string, label: string, left: number, top: number, width: number) => elements.push({ id, type: 'text', left, top, width, height: 65, rotate: 0, content: `<p style="font-size:36px;text-align:center">${escape(label)}</p>`, defaultFontName: 'Arial', defaultColor: '#20382f' });
  text('title', input.title, 60, 20, 880);
  if (input.templateId === 'practice.listen-image') {
    if (!input.audioSrc) throw new Error('Listening practice requires saved audio or promptText for synthesis');
    activity.mediaElementId = 'prompt-audio';
    activity.optionImageElementIds = {};
    elements.push({ id: 'prompt-audio', type: 'audio', left: 460, top: 460, width: 60, height: 60, rotate: 0, fixedRatio: true, color: '#527768', loop: false, autoplay: false, src: ref(input.audioSrc) });
    options.forEach((o, i) => {
      if (!o.imageSrc) throw new Error('Each listening option requires a saved image');
      const id = `option-${i}`;
      activity.optionImageElementIds![o.value] = id;
      const width = Math.min(230, 850 / options.length);
      const left = 75 + i * 850 / options.length;
      elements.push({ id, type: 'image', left, top: 145, width, height: 230, rotate: 0, fixedRatio: true, src: ref(o.imageSrc) });
      text(`label-${i}`, o.value, left, 395, width);
    });
  } else {
    if (!input.imageSrc) throw new Error('Picture-word practice requires a stem image');
    activity.imageElementId = 'stem-image';
    elements.push({ id: 'stem-image', type: 'image', left: 350, top: 105, width: 300, height: 275, rotate: 0, fixedRatio: true, src: ref(input.imageSrc) });
    options.forEach((o, i) => text(`label-${i}`, o.label, 65 + i * 870 / options.length, 420, 850 / options.length));
  }
  const scenes = [
    { id: activity.contentRef, stageId: input.stageId, type: 'slide', title: input.title, order: input.order * 2, actions: [], content: { type: 'slide', canvas: { id: activity.contentRef, viewportSize: 1000, viewportRatio: 0.5625, theme: { backgroundColor: '#fffdf6', themeColors: ['#527768'], fontColor: '#20382f', fontName: 'Arial' }, elements } } },
    { id: activity.quizSceneId, stageId: input.stageId, type: 'quiz', title: input.title, order: input.order * 2 + 1, actions: [], content: { type: 'quiz', questions: [{ id: 'q1', type: 'single', question: input.templateId === 'practice.listen-image' ? 'Listen and choose.' : 'Look and choose.', options: options.map(({ value, label }) => ({ value, label })), answer: [input.answer], hasAnswer: true }] } },
  ] as Scene[];
  for (const scene of scenes) if (!validateScene(scene).valid) throw new Error('Generated activity does not satisfy the native DSL');
  return { activity, scenes };
}
