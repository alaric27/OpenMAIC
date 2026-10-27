import { putSceneBringingCurrent } from '@/lib/server/agent-runtime/document-writes';
import { Type } from 'typebox';
import { importPlanMedia, type PlanSelection } from './plan-media';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { componentAssets } from './protocol';
import { propsIssue } from './schema-validation';
import { definitionFromTemplate } from './definitions';
import { productionSpec } from '../client';
import {
  runStageMutation,
  getServerPersistenceProvider,
  assetPrincipalForOwner,
  type ToolDeps,
} from '../adapter';
export function componentSceneTool(
  deps: ToolDeps,
  currentPlan?: () => PlanSelection | undefined,
): AgentTool {
  const assetCache = new Map<string, string>();
  return {
    name: 'lw_save_component_scene',
    label: '保存组件场景',
    description:
      'Save a single-page component using an exact published LearnWeave template revision. Read its contentSchema and assetSlots from lw_read_activities; For original media URLs listed in a published course plan, read it with lw_read_course_plan first (or pass planSelection:{id,revision}); this tool imports them into the current author asset library automatically. Do not use fetch_url or ask the user to re-upload plan media. For new media, generate and persist declared media first, wait for native async video with lw_wait_component_media, then submit JSON props matching that schema. Do not invent template-specific fields, HTML, actions or multiple pages. Finally use lw_save_course to bind activities and export.',
    parameters: Type.Object(
      {
        stageId: Type.String(),
        sceneId: Type.String(),
        title: Type.String(),
        order: Type.Integer({ minimum: 1 }),
        templateId: Type.String(),
        templateRevision: Type.Integer({ minimum: 1 }),
        props: Type.Record(Type.String(), Type.Unknown()),
        planSelection: Type.Optional(
          Type.Object(
            { id: Type.String(), revision: Type.Integer({ minimum: 1 }) },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_id, raw, signal) {
      try {
        const input = raw as {
          stageId: string;
          sceneId: string;
          title: string;
          order: number;
          templateId: string;
          templateRevision: number;
          props: Record<string, any>;
          planSelection?: PlanSelection;
        };
        const spec = await productionSpec();
        const template = spec.templateVersions.find(
          (t) => t.value.id === input.templateId && t.revision === input.templateRevision,
        )?.value as Record<string, any> | undefined;
        if (!template || template.sceneType !== 'component') throw Error('已发布组件模板不存在');
        const definition = definitionFromTemplate(template);
        const issue = propsIssue(definition.contentSchema, input.props);
        if (issue) throw Error(issue);
        const combined =
          signal && deps.abortSignal
            ? AbortSignal.any([signal, deps.abortSignal])
            : signal || deps.abortSignal;
        combined?.throwIfAborted();
        const props = structuredClone(input.props);
        const docBefore = await deps.store.loadDocument(input.stageId);
        if (!docBefore) throw Error('课程不存在');
        const oldBefore = docBefore.scenes.find((s) => s.id === input.sceneId);
        if (
          oldBefore &&
          (oldBefore.type !== 'component' ||
            oldBefore.content.componentRef.id !== definition.componentRef.id)
        )
          throw Error('不能覆盖其他类型的已有场景');
        if (docBefore.scenes.some((s) => s.order === input.order && s.id !== input.sceneId))
          throw Error('场景顺序已被占用');
        await importPlanMedia({
          deps,
          stageId: input.stageId,
          selection: input.planSelection || currentPlan?.(),
          spec,
          props,
          resources: componentAssets(props, definition.assetSlots),
          signal: combined,
          cache: assetCache,
        });
        const content = {
          type: 'component' as const,
          componentRef: definition.componentRef,
          props,
          assetSlots: structuredClone(definition.assetSlots),
        };
        const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
        const resources = componentAssets(props, definition.assetSlots);
        const owner = assetPrincipalForOwner(await deps.currentOwner());
        const verified: { assetId: string; kind: string }[] = [];
        for (const slot of resources) {
          const match = /^\/api\/persistence\/assets\/([A-Za-z0-9_-]+)\/content$/.exec(slot.ref);
          const assetId = match?.[1] || slot.ref;
          if (!/^[A-Za-z0-9_-]{1,160}$/.test(assetId))
            throw Error('素材必须先保存至当前作者素材库');
          const asset = await provider.assetStore.identify(owner, assetId);
          if (!asset || !asset.mime?.startsWith(slot.kind + '/'))
            throw Error('素材缺失或类型不匹配');
          verified.push({ assetId, kind: slot.kind });
        }
        const assetId = verified[0]?.assetId,
          kind = verified[0]?.kind;
        await runStageMutation(combined, async () => {
          const doc = await deps.store.loadDocument(input.stageId);
          if (!doc) throw Error('课程不存在');
          const old = doc.scenes.find((s) => s.id === input.sceneId);
          if (
            old &&
            (old.type !== 'component' || old.content.componentRef.id !== content.componentRef.id)
          )
            throw Error('不能覆盖其他类型的已有场景');
          if (doc.scenes.some((s) => s.order === input.order && s.id !== input.sceneId))
            throw Error('场景顺序已被占用');
          await putSceneBringingCurrent(deps.store, input.stageId, {
            id: input.sceneId,
            stageId: input.stageId,
            title: input.title,
            order: input.order,
            type: 'component',
            content,
          });
        });
        deps.onCheckpoint({
          tool: 'lw_save_component_scene',
          stageId: input.stageId,
          sceneId: input.sceneId,
          sceneType: 'component',
          detail: '组件场景已保存，请重新保存活动清单',
        });
        return {
          details: {
            stageId: input.stageId,
            sceneId: input.sceneId,
            saved: true,
            assetId,
            kind,
            assets: verified,
          },
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sceneId: input.sceneId,
                saved: true,
                assetId,
                kind,
              }),
            },
          ],
        };
      } catch (e) {
        return {
          details: {},
          isError: true,
          content: [{ type: 'text', text: e instanceof Error ? e.message : '组件保存失败' }],
        };
      }
    },
  };
}
