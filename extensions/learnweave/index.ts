import { componentMediaTool } from './components/media';
import type { PlanSelection } from './components/plan-media';
import { componentSceneTool } from './components/production';
import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { learnweaveEnabled } from './config';
import { wrapTools, runStageMutation, type ToolDeps } from './adapter';
import {
  readCourse,
  saveCourse,
  productionSpec,
  produceBundle,
  ProductionError,
} from './production';
const result = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  details: value,
  isError,
});
export async function buildLearnWeaveTools(deps: ToolDeps): Promise<AgentTool[]> {
  if (!learnweaveEnabled()) return [];
  let currentPlan: PlanSelection | undefined;
  const read: AgentTool = {
    name: 'lw_read_activities',
    label: '读取课程活动',
    description:
      'Read the explicit ordered activity manifest, revision, native scene references and current LearnWeave production specification. Never use prototype template fields. Read before saving.',
    parameters: Type.Object({ stageId: Type.String({ minLength: 1, maxLength: 128 }) }),
    async execute(_id, raw) {
      const { stageId } = raw as { stageId: string };
      const document = await deps.store.loadDocument(stageId);
      return result({
        ...((await readCourse(stageId)) || { revision: 0, manifest: null }),
        productionSpec: await productionSpec(),
        scenes: document?.scenes.map((s) => ({ id: s.id, title: s.title, type: s.type })),
      });
    },
  };
  const plan: AgentTool = {
    name: 'lw_read_course_plan',
    label: '读取课程节点配置',
    description:
      'Read the published ordered lesson nodes from LearnWeave before generating native scenes. Call without an ID to list plans; pass exact planId and revision to read goals, content requirements and pinned production templates. Never invent node order.',
    parameters: Type.Object(
      {
        planId: Type.Optional(Type.String()),
        revision: Type.Optional(Type.Integer({ minimum: 1 })),
      },
      { additionalProperties: false },
    ),
    async execute(_id, raw) {
      const { planId, revision } = raw as { planId?: string; revision?: number };
      const spec = await productionSpec();
      if (!planId) return result({ plans: spec.plans });
      const selected = spec.planVersions.find(
        (p) =>
          p.value.id === planId &&
          (revision === undefined
            ? spec.plans.some((c) => c.value.id === planId && c.revision === p.revision)
            : p.revision === revision),
      );
      if (!selected) return result({ error: '已发布节点配置不存在' }, true);
      currentPlan = { id: selected.value.id, revision: selected.revision };
      return result({
        plan: selected,
        activities: selected.activities,
        templates: (selected.activities?.map((a) => a.configuration) || selected.value.nodes).map(
          (n) =>
            spec.templateVersions.find(
              (t) => t.value.id === n.templateId && t.revision === n.templateRevision,
            ),
        ),
        mediaInstruction:
          'For original media URLs in this plan, pass planSelection:{id:plan.value.id,revision:plan.revision} to lw_save_component_scene. It imports declared media URLs into the current author asset library and replaces props with owned references. Do not use fetch_url, ask_user for re-upload, or generate replacements for available original media.',
        instruction:
          selected.value.schemaVersion === 2
            ? 'The plan has teaching nodes containing multiple Segments. Generate exactly one activity for each entry in activities, in that order. Use activities[].configuration.id as the activity ID, its configuration for template, contentRequirements and task, and its resolvedConfiguration for execution. Keep nodeId and segmentId identities. Save manifest.planSelection with the exact plan ID and revision. LearnWeave resolves all node goals, per-Segment overrides and the hierarchy; never flatten or discard the published plan.'
            : 'Generate each node in this order using its goal, contentRequirements, task and resolvedConfiguration. Save manifest.planSelection with the exact plan ID and revision. Activity IDs must equal node IDs.',
      });
    },
  };
  // Fetch the authoritative JSON Schema, never a bundled copy of LearnWeave's types.
  // A service outage must not prevent native OpenMAIC tools from being registered.
  let authoringSchema: Record<string, unknown>;
  try {
    authoringSchema = (await productionSpec()).authoringSchema;
  } catch {
    return wrapTools([read, plan], deps);
  }
  const save: AgentTool = {
    name: 'lw_save_course',
    label: '保存课程活动清单',
    description:
      'Explicitly save a complete ordered new-protocol course activity manifest. Existing native Scenes must already exist. Read productionSpec.templates: id is the template code, sceneType is the native slide/quiz/interactive/pbl/component type, and category is teaching/practice/media for organization only. Follow the selected template instructions and published teaching prompts; never infer an executor from its code or category. Set manifest.templateSelections[activityId] to its exact {id,revision}; saving resolves the published template execution requirements and teaching prompt snapshots. Use kind/data, objectiveIds and sceneIds. The activity array is the only classroom sequence. Do not infer answers or transform old templates. Saving also checks the actual export. exportReady=false or isError means the course is not ready: use the returned revision and report to repair the native document and save again. Re-read revision on conflict.',
    parameters: Type.Object(
      {
        stageId: Type.String({ minLength: 1, maxLength: 128 }),
        expectedRevision: Type.Integer({ minimum: 0 }),
        manifest: authoringSchema as any,
      },
      { additionalProperties: false },
    ),
    async execute(_id, raw, signal) {
      const input = raw as { stageId: string; expectedRevision: number; manifest: unknown };
      try {
        const combined =
          signal && deps.abortSignal
            ? AbortSignal.any([signal, deps.abortSignal])
            : signal || deps.abortSignal;
        return await runStageMutation(combined, async () => {
          const saved = await saveCourse(
            await deps.currentOwner(),
            input.stageId,
            input.expectedRevision,
            input.manifest,
            deps.fence,
            () => combined?.throwIfAborted(),
          );
          let bundle;
          try {
            combined?.throwIfAborted();
            bundle = await produceBundle(await deps.currentOwner(), input.stageId);
            combined?.throwIfAborted();
          } catch (e) {
            return result(
              {
                ...saved,
                stageId: input.stageId,
                exportReady: false,
                error: e instanceof Error ? e.message : '导出检查失败',
                ...(e instanceof ProductionError && e.report ? { report: e.report } : {}),
              },
              true,
            );
          }
          deps.onCheckpoint({
            tool: 'lw_save_course',
            stageId: input.stageId,
            detail: '新协议活动清单已保存并通过导出检查',
          });
          return result({
            ...saved,
            stageId: input.stageId,
            exportReady: true,
            source: bundle.source,
            assetCount: bundle.assets.length,
          });
        });
      } catch (e) {
        return result({ error: e instanceof Error ? e.message : '保存失败' }, true);
      }
    },
  };
  return wrapTools(
    [read, plan, componentSceneTool(deps, () => currentPlan), componentMediaTool(deps), save],
    deps,
  );
}
