import { createHash } from 'node:crypto';
import { Value } from 'typebox/value';
import {
  manifestSchema,
  TEMPLATE_RESERVED_ACTIVITY_IDS,
  type TemplateManifest,
} from './contracts/generated';
import { templateBindingIssue } from './contracts/template-bindings';
import type { CourseDocument } from './adapter';

export function checkedManifest(value: unknown, document: CourseDocument): TemplateManifest {
  if (!Value.Check(manifestSchema, value)) throw new Error('Invalid LearnWeave template manifest');
  const manifest = value as TemplateManifest;
  const ids = new Set<string>();
  for (const t of manifest.activities) {
    if (ids.has(t.id) || TEMPLATE_RESERVED_ACTIVITY_IDS.includes(t.id))
      throw new Error('Duplicate or reserved activity id');
    ids.add(t.id);
    if (t.standard) {
      const { standard, ...activity } = t;
      if (
        standard.id !== t.templateId ||
        standard.version !== t.templateVersion ||
        !Value.Check(standard.schema, activity)
      )
        throw new Error(`Activity ${t.id}: published standard schema mismatch`);
    }
    const page = document.scenes.find((s) => s.id === t.contentRef);
    if (!page || page.content.type !== 'slide')
      throw new Error(`Activity ${t.id}: presentation slide missing`);
    const scene = document.scenes.find((s) => s.id === t.quizSceneId);
    const issue = templateBindingIssue(t, {
      elements: page.content.canvas.elements,
      questions: scene?.content.type === 'quiz' ? scene.content.questions : undefined,
    });
    if (issue) throw new Error(`Activity ${t.id}: ${issue}`);
  }
  return manifest;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

/** Covers learning semantics and references; layout-only edits do not invalidate bindings. */
export function bindingFingerprint(manifest: TemplateManifest, doc: CourseDocument) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonical(
          manifest.activities.map((t) => {
            const page = doc.scenes.find((s) => s.id === t.contentRef);
            const ids = new Set([
              t.mediaElementId,
              t.imageElementId,
              ...Object.values(t.optionImageElementIds || {}),
            ]);
            const elements =
              page?.content.type === 'slide'
                ? page.content.canvas.elements
                    .filter((e) => ids.has(e.id))
                    .map((e) => ({ id: e.id, type: e.type, src: 'src' in e ? e.src : undefined }))
                    .sort((a, b) => a.id.localeCompare(b.id))
                : [];
            return { t, elements, quiz: doc.scenes.find((s) => s.id === t.quizSceneId)?.content };
          }),
        ),
      ),
    )
    .digest('hex');
}
