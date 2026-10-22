import { createHash } from 'node:crypto';
import { Value } from 'typebox/value';
import { manifestSchema, type TemplateManifest } from './contracts/generated';
import type { CourseDocument } from './adapter';

export function checkedManifest(value: unknown, document: CourseDocument): TemplateManifest {
  if (!Value.Check(manifestSchema, value)) throw new Error('Invalid LearnWeave template manifest');
  const manifest = value as TemplateManifest;
  const ids = new Set<string>();
  for (const t of manifest.activities) {
    if (ids.has(t.id) || ['picture-talk', 'plural-check'].includes(t.id)) throw new Error('Duplicate or reserved activity id');
    ids.add(t.id);
    const page = document.scenes.find((s) => s.id === t.contentRef);
    if (!page || page.content.type !== 'slide') throw new Error(`Activity ${t.id}: presentation slide missing`);
    const element = (id: string | undefined, kind: string) => page.content.type === 'slide' && page.content.canvas.elements.find((e) => e.id === id && e.type === kind);
    if (t.templateId.startsWith('practice.')) {
      const scene = document.scenes.find((s) => s.id === t.quizSceneId);
      if (!scene || scene.content.type !== 'quiz' || scene.content.questions.length !== 1) throw new Error(`Activity ${t.id}: quiz missing`);
      const q = scene.content.questions[0];
      if (q.id !== t.questionId || q.type !== 'single' || !q.options || q.options.length < 2 || q.options.length > 6 || new Set(q.options.map((o) => o.value)).size !== q.options.length || q.answer?.length !== 1 || !q.options.some((o) => o.value === q.answer![0])) throw new Error(`Activity ${t.id}: invalid question or answer`);
      if (t.templateId === 'practice.listen-image') {
        if (!element(t.mediaElementId, 'audio') || !t.optionImageElementIds || Object.keys(t.optionImageElementIds).length !== q.options.length || new Set(Object.values(t.optionImageElementIds)).size !== q.options.length || q.options.some((o) => !element(t.optionImageElementIds![o.value], 'image'))) throw new Error(`Activity ${t.id}: audio/image binding missing`);
      } else if (!element(t.imageElementId, 'image')) throw new Error(`Activity ${t.id}: stem image missing`);
    } else if (t.templateId.startsWith('media.') && !element(t.mediaElementId, t.templateId === 'media.audio' ? 'audio' : 'video')) throw new Error(`Activity ${t.id}: media binding missing`);
  }
  return manifest;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

/** Covers learning semantics and references; layout-only edits do not invalidate bindings. */
export function bindingFingerprint(manifest: TemplateManifest, doc: CourseDocument) {
  return createHash('sha256').update(JSON.stringify(canonical(manifest.activities.map((t) => {
    const page = doc.scenes.find((s) => s.id === t.contentRef);
    const ids = new Set([t.mediaElementId, t.imageElementId, ...Object.values(t.optionImageElementIds || {})]);
    const elements = page?.content.type === 'slide' ? page.content.canvas.elements.filter((e) => ids.has(e.id)).map((e) => ({ id: e.id, type: e.type, src: 'src' in e ? e.src : undefined })).sort((a, b) => a.id.localeCompare(b.id)) : [];
    return { t, elements, quiz: doc.scenes.find((s) => s.id === t.quizSceneId)?.content };
  })))).digest('hex');
}
