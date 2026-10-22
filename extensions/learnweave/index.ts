import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import {
  wrapTools,
  runStageMutation,
  assertOwnedAssets,
  promptAudio,
  type ToolDeps,
} from './adapter';
import { learnweaveEnabled } from './config';
import { templateSchema, type TemplateManifest } from './contracts/generated';
import { buildActivity, sourceAssetId, type ActivityInput } from './templates';
import { readTemplates, writeTemplates } from './store';
import { checkedManifest, bindingFingerprint } from './validate';

const Id = Type.String({ minLength: 1, maxLength: 128 });
const params = Type.Object(
  {
    stageId: Id,
    activityId: Type.String({ pattern: '^[A-Za-z0-9_-]{1,64}$' }),
    templateId: templateSchema.properties.templateId,
    title: Type.String({ minLength: 1, maxLength: 120 }),
    order: Type.Integer({ minimum: 0, maximum: 49 }),
    expectedRevision: Type.Integer({ minimum: 0 }),
    contentRef: Type.Optional(Id),
    mediaElementId: Type.Optional(Id),
    promptText: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
    audioSrc: Type.Optional(Id),
    imageSrc: Type.Optional(Id),
    answer: Type.Optional(Id),
    options: Type.Optional(
      Type.Array(
        Type.Object(
          {
            value: Id,
            label: Type.String({ minLength: 1, maxLength: 500 }),
            imageSrc: Type.Optional(Id),
          },
          { additionalProperties: false },
        ),
        { minItems: 2, maxItems: 6 },
      ),
    ),
    hints: templateSchema.properties.hints,
    instructions: Type.Optional(templateSchema.properties.instructions),
    maxAttempts: templateSchema.properties.maxAttempts,
  },
  { additionalProperties: false },
);
const result = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  details: value,
  isError,
});
export async function buildLearnWeaveTools(deps: ToolDeps): Promise<AgentTool[]> {
  if (!learnweaveEnabled()) return [];
  const read: AgentTool = {
    name: 'lw_read_activities',
    label: '读取 LearnWeave 活动',
    description:
      'Read the template manifest and its revision. Call before creating or changing an activity; absent manifest means expectedRevision 0.',
    parameters: Type.Object({ stageId: Id }, { additionalProperties: false }),
    async execute(_id, raw) {
      return result(await readTemplates((raw as { stageId: string }).stageId));
    },
  };
  const upsert: AgentTool = {
    name: 'lw_upsert_activity',
    label: '保存模板活动',
    description:
      'Create/update a typed LearnWeave activity. Stable activityId makes retries safe. Read revision first. practice.listen-image needs options with saved image asset IDs, answer, and audioSrc or promptText; practice.image-word needs imageSrc, text options and answer. Teaching/media bind an existing contentRef (media also needs mediaElementId). order is the logical activity index. Native slides/quizzes and explicit bindings are saved together as a recoverable operation. All hints/instructions are author-only. Native preview is visual; LearnWeave renders real interactions.',
    parameters: params,
    async execute(_id, raw, signal) {
      if (!Value.Check(params, raw)) return result({ error: 'Invalid activity parameters' }, true);
      const input = raw as ActivityInput;
      const combined =
        signal && deps.abortSignal
          ? AbortSignal.any([signal, deps.abortSignal])
          : signal || deps.abortSignal;
      const active = () => combined?.throwIfAborted();
      try {
        return await runStageMutation(combined, async () => {
          active();
          const ownerId = await deps.currentOwner();
          const previous = await readTemplates(input.stageId);
          if ((previous?.revision ?? 0) !== input.expectedRevision)
            throw new Error('Revision changed; call lw_read_activities and retry');
          const doc = await deps.store.loadDocument(input.stageId);
          if (!doc) throw new Error('Course not found');
          if (input.templateId === 'practice.listen-image' && !input.audioSrc && input.promptText)
            input.audioSrc = await promptAudio(
              input.promptText,
              input.stageId,
              ownerId,
              combined,
              deps.fence,
            );
          const assets = [
            ...(input.audioSrc ? [{ src: input.audioSrc, kind: 'audio' }] : []),
            ...(input.imageSrc ? [{ src: input.imageSrc, kind: 'image' }] : []),
            ...(input.options || [])
              .filter((o) => !!o.imageSrc)
              .map((o) => ({ src: o.imageSrc!, kind: 'image' })),
          ];
          await assertOwnedAssets(
            ownerId,
            assets.map((a) => ({ ...a, id: sourceAssetId(a.src) })),
          );
          const built = buildActivity(input);
          const activities = (previous?.manifest.activities || []).filter(
            (a) => a.id !== input.activityId,
          );
          activities.splice(Math.min(input.order, activities.length), 0, built.activity);
          if (built.scenes.length) {
            const replacement = new Set(built.scenes.map((s) => s.id));
            doc.scenes = [
              ...doc.scenes.filter((s) => !replacement.has(s.id)),
              ...built.scenes,
            ].sort((a, b) => a.order - b.order);
          }
          const manifest: TemplateManifest = {
            schemaVersion: 1,
            revision: input.expectedRevision + 1,
            activities,
          };
          checkedManifest(manifest, doc);
          const pending = await writeTemplates(
            input.stageId,
            ownerId,
            input.expectedRevision,
            manifest,
            'pending',
            '',
            active,
            deps.fence,
          );
          active();
          if (built.scenes.length)
            await deps.store.saveDocument({
              ...doc,
              stage: { ...doc.stage, updatedAt: Date.now() },
            });
          active();
          const persisted = await deps.store.loadDocument(input.stageId);
          if (!persisted) throw new Error('Course removed while saving');
          checkedManifest(pending, persisted);
          const ready = await writeTemplates(
            input.stageId,
            ownerId,
            pending.revision,
            pending,
            'ready',
            bindingFingerprint(pending, persisted),
            active,
            deps.fence,
          );
          deps.onCheckpoint({
            tool: 'lw_upsert_activity',
            stageId: input.stageId,
            detail: input.title,
            sceneId: built.activity.contentRef,
          });
          return result({ status: 'ready', manifest: ready });
        });
      } catch (error) {
        return result(
          {
            error: error instanceof Error ? error.message : 'Activity save failed; read and retry',
          },
          true,
        );
      }
    },
  };
  return wrapTools([read, upsert], deps);
}
