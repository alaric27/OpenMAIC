import {
  getProductionStandards,
  resolveStandard,
  assertManifestStandards,
} from './standards-client';
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
import { producerInputSchema, type TemplateManifest } from './contracts/generated';
import { buildActivity, sourceAssetId, type ActivityInput } from './templates';
import { readTemplates, writeTemplates } from './store';
import { assertManifestAssets } from './asset-validation';
import { ActivityInputError } from './errors';
import { resolveAudioReference } from './audio-reference';
import { boundAssets, productionInputIssue } from './contracts/template-bindings';
import { checkedManifest, bindingFingerprint } from './validate';

const Id = Type.String({ minLength: 1, maxLength: 128 });
// Keep provider tool signatures stable across registry edits; execution resolves the published ID.
const params = {
  ...producerInputSchema,
  properties: {
    ...producerInputSchema.properties,
    templateId: Type.String({ minLength: 1, maxLength: 128 }),
  },
};
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
      'Read the template manifest, revision and the versioned LearnWeave production specification. Call before planning, creating or changing activities; absent manifest means expectedRevision 0.',
    parameters: Type.Object({ stageId: Id }, { additionalProperties: false }),
    async execute(_id, raw) {
      const standards = await getProductionStandards();
      const row = await readTemplates((raw as { stageId: string }).stageId);
      return result({
        ...(row || { revision: 0, manifest: null }),
        productionSpec: standards.productionSpec,
        activityInput: standards.producerInputSchema,
        standards: standards.entries,
      });
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
      'Create/update an activity according to the versioned productionSpec and activityInput returned by lw_read_activities. Stable activityId makes retries safe; read revision first. Use saved assets. Audio may be a saved audio asset or same-course /api/classroom-media/ reference; promptText synthesizes missing required audio. Native content and explicit bindings are saved together. For retryable:false errors, correct inputs before retrying. LearnWeave owns teaching methods, grading and classroom execution. Native preview is visual; LearnWeave renders interactions.',
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
          const standards = await getProductionStandards();
          const standard = resolveStandard(standards, input.templateId, input.templateVersion);
          const inputIssue = productionInputIssue(standard.content, input);
          if (inputIssue) throw new ActivityInputError('INVALID_ACTIVITY_PARAMETERS', inputIssue);
          // Pure dry-run: validate the registered activity schema before importing audio or TTS.
          // This reference is never saved; the final build uses the resolved real asset.
          buildActivity(
            {
              ...input,
              ...(standard.content.choice?.stimulus === 'audio'
                ? { audioSrc: 'schema-validation-audio' }
                : {}),
            },
            standard,
          );
          if (input.audioSrc)
            input.audioSrc = await resolveAudioReference({
              src: input.audioSrc,
              stageId: input.stageId,
              ownerId,
              signal: combined,
              fence: deps.fence,
            });
          if (standard.content.choice?.stimulus === 'audio' && !input.audioSrc && input.promptText)
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
          const built = buildActivity(input, standard);
          let migratedBinding = false;
          if (standard.content.builder === 'existing-slide') {
            const page = doc.scenes.find((s) => s.id === input.contentRef);
            const audioIds = new Set(
              boundAssets(built.activity)
                .filter((b) => b.kind === 'audio')
                .map((b) => b.id),
            );
            for (const element of page?.content.type === 'slide'
              ? page.content.canvas.elements.filter((e) => audioIds.has(e.id))
              : []) {
              if (element?.type === 'audio') {
                const id = await resolveAudioReference({
                  src: element.src,
                  stageId: input.stageId,
                  ownerId,
                  signal: combined,
                  fence: deps.fence,
                });
                const src = `/api/persistence/assets/${id}/content`;
                migratedBinding = migratedBinding || src !== element.src;
                element.src = src;
              }
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
          assertManifestStandards(manifest, standards);
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
