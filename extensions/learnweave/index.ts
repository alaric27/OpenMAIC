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
import { assertManifestAssets } from './asset-validation';
import { ActivityInputError } from './errors';
import { resolveAudioReference } from './audio-reference';
import { checkedManifest, bindingFingerprint } from './validate';

const MediaRef = Type.String({ minLength: 1, maxLength: 2048 });
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
    audioSrc: Type.Optional(MediaRef),
    imageSrc: Type.Optional(MediaRef),
    answer: Type.Optional(Id),
    options: Type.Optional(
      Type.Array(
        Type.Object(
          {
            value: Id,
            label: Type.String({ minLength: 1, maxLength: 500 }),
            imageSrc: Type.Optional(MediaRef),
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
  // Per agent toolset: deterministic input errors must not repeat storage/TTS work.
  const rejected = new Map<string, { signature: string; details: object }>();
  const signatureOf = (value: unknown): string => {
    const canonical = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(canonical)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v)
                .filter(([k]) => k !== 'expectedRevision')
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, x]) => [k, canonical(x)]),
            )
          : v;
    return JSON.stringify(canonical(value));
  };
  const upsert: AgentTool = {
    name: 'lw_upsert_activity',
    label: '保存模板活动',
    description:
      'Create/update a typed LearnWeave activity. Stable activityId makes retries safe. Read revision first. practice.listen-image needs options with saved image asset IDs, answer, and audioSrc or promptText (prefer promptText alone for TTS). audioSrc accepts a saved audio asset or a same-course /api/classroom-media/ file, which is imported into the asset pool. Never use image IDs for audio; practice.image-word needs imageSrc, text options and answer. Teaching/media bind an existing contentRef (media also needs mediaElementId). order is the logical activity index. Native slides/quizzes and explicit bindings are saved together as a recoverable operation. For retryable:false errors, change the indicated input before retrying; reading revision does not fix media errors. All hints/instructions are author-only. Native preview is visual; LearnWeave renders real interactions.',
    parameters: params,
    async execute(_id, raw, signal) {
      if (!Value.Check(params, raw))
        return result(
          {
            code: 'INVALID_ACTIVITY_PARAMETERS',
            retryable: false,
            error: 'Invalid activity parameters',
            fields: [...Value.Errors(params, raw)].map((e) => ({
              path: e.instancePath,
              message: e.message,
            })),
            nextAction:
              'Correct the reported fields before retrying. Do not retry unchanged arguments.',
          },
          true,
        );
      // TTS/reference normalization must not mutate the model's original arguments.
      const input = structuredClone(raw) as ActivityInput;
      const key = input.stageId + ':' + input.activityId;
      const signature = signatureOf(input);
      const priorError = rejected.get(key);
      if (priorError?.signature === signature)
        return result(
          {
            ...priorError.details,
            repeatedInput: true,
            nextAction:
              'STOP repeating this call. No save or TTS was attempted. Change the invalid media input; lw_read_activities and expectedRevision changes cannot fix it. If no valid media is available, report the blocker.',
          },
          true,
        );
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
            throw new ActivityInputError(
              'REVISION_CONFLICT',
              'Revision changed; call lw_read_activities and retry',
              'expectedRevision',
              'Call lw_read_activities, then retry with its revision.',
            );
          const doc = await deps.store.loadDocument(input.stageId);
          if (!doc) throw new Error('Course not found');
          if (input.audioSrc)
            input.audioSrc = await resolveAudioReference({
              src: input.audioSrc,
              stageId: input.stageId,
              ownerId,
              signal: combined,
              fence: deps.fence,
            });
          if (input.templateId === 'practice.listen-image' && !input.audioSrc && input.promptText)
            input.audioSrc = await promptAudio(
              input.promptText,
              input.stageId,
              ownerId,
              combined,
              deps.fence,
            );
          const assets = [
            ...(input.audioSrc ? [{ src: input.audioSrc, kind: 'audio', field: 'audioSrc' }] : []),
            ...(input.imageSrc ? [{ src: input.imageSrc, kind: 'image', field: 'imageSrc' }] : []),
            ...(input.options || [])
              .filter((o) => !!o.imageSrc)
              .map((o) => ({
                src: o.imageSrc!,
                kind: 'image',
                field: `options[${o.value}].imageSrc`,
              })),
          ];
          await assertOwnedAssets(
            ownerId,
            assets.map((a) => ({ ...a, id: sourceAssetId(a.src) })),
          );
          const built = buildActivity(input);
          let migratedBinding = false;
          if (input.templateId === 'media.audio') {
            const page = doc.scenes.find((s) => s.id === input.contentRef);
            const element =
              page?.content.type === 'slide'
                ? page.content.canvas.elements.find((e) => e.id === input.mediaElementId)
                : undefined;
            if (element?.type === 'audio') {
              const id = await resolveAudioReference({
                src: element.src,
                stageId: input.stageId,
                ownerId,
                signal: combined,
                fence: deps.fence,
              });
              const src = `/api/persistence/assets/${id}/content`;
              migratedBinding = src !== element.src;
              element.src = src;
            }
          }
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
          // Validate this mutation so other legacy bindings can be repaired one by one.
          // Bundle export still validates every activity before allowing import.
          await assertManifestAssets(ownerId, { ...manifest, activities: [built.activity] }, doc);
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
          if (built.scenes.length || migratedBinding)
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
          rejected.delete(key);
          return result({ status: 'ready', manifest: ready });
        });
      } catch (error) {
        const conflict =
          (error instanceof ActivityInputError && error.code === 'REVISION_CONFLICT') ||
          (error instanceof Error && error.message === 'Template revision changed; read and retry');
        const details = {
          error: error instanceof Error ? error.message : 'Activity save failed',
          code: conflict
            ? 'REVISION_CONFLICT'
            : error instanceof ActivityInputError
              ? error.code
              : 'ACTIVITY_SAVE_FAILED',
          retryable: conflict,
          ...(error instanceof ActivityInputError && error.field ? { field: error.field } : {}),
          nextAction: conflict
            ? 'Call lw_read_activities, then retry with its revision.'
            : error instanceof ActivityInputError
              ? error.nextAction
              : 'Inspect and resolve the error before retrying. Do not repeat unchanged arguments; report a blocker if it cannot be resolved.',
        };
        if (
          error instanceof ActivityInputError &&
          ['INVALID_ASSET_REFERENCE', 'INVALID_AUDIO_REFERENCE', 'ASSET_TYPE_MISMATCH'].includes(
            error.code,
          )
        ) {
          if (rejected.size >= 50) rejected.delete(rejected.keys().next().value!);
          rejected.set(key, { signature, details });
        }
        return result(details, true);
      }
    },
  };
  return wrapTools([read, upsert], deps);
}
