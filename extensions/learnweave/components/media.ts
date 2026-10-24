import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { setTimeout as delay } from 'node:timers/promises';
import { getPendingMediaTask } from '@/lib/server/agent-runtime/pending-media';
import { getAgentSessionStore } from '@/lib/server/agent-runtime/store';
import type { ToolDeps } from '../adapter';
/** Native generate_video is detached. Resolve its real output before authoring a component. */
export function componentMediaTool(deps: ToolDeps): AgentTool {
  return {
    name: 'lw_wait_component_media',
    label: '等待组件视频素材',
    description:
      'After native generate_video returns gen_vid_..., call this with its stageId and ref to wait up to 55 seconds for the actual saved video asset. If status=generating call this SAME tool again with the SAME ref; never regenerate a pending video. Only status=done with src may be passed as videoUrl to lw_save_component_scene. No temporary slide/placeholder component is needed. Failed or lost jobs are reported explicitly.',
    parameters: Type.Object(
      { stageId: Type.String(), ref: Type.String() },
      { additionalProperties: false },
    ),
    async execute(_id, raw, signal) {
      const { stageId, ref } = raw as { stageId: string; ref: string };
      const result = (details: Record<string, unknown>, isError = false) => ({
        details,
        isError,
        content: [{ type: 'text' as const, text: JSON.stringify(details) }],
      });
      if (!deps.sessionId) return result({ error: '当前会话不可识别' }, true);
      const combined =
        signal && deps.abortSignal
          ? AbortSignal.any([signal, deps.abortSignal])
          : signal || deps.abortSignal;
      let cursor = 0;
      let known = false;
      const store = await getAgentSessionStore();
      const session = await store.getSession(deps.sessionId);
      if (!session || session.ownerId !== (await deps.currentOwner()))
        return result({ error: '素材任务不可访问' }, true);
      const until = Date.now() + 55000;
      while (Date.now() < until) {
        combined?.throwIfAborted();
        const task = getPendingMediaTask(ref);
        if (task && (task.stageId !== stageId || task.sessionId !== deps.sessionId))
          return result({ error: '素材任务不可访问' }, true);
        if (task && task.stageId === stageId && task.sessionId === deps.sessionId) {
          known = true;
          if (task.status === 'done') return result({ status: 'done', src: task.src, ref });
          if (task.status === 'failed')
            return result({ status: 'failed', errorCode: task.errorCode, ref }, true);
        }
        const events = await store.readEventsAfter(deps.sessionId, cursor);
        for (const event of events) {
          cursor = Math.max(cursor, event.id);
          const data = event.data as Record<string, unknown>;
          if (event.type === 'media_ready' && data.ref === ref && data.stageId === stageId)
            return result(data, data.status === 'failed');
          if (event.type === 'tool_execution_end' && data.toolName === 'generate_video') {
            const output = (data.result as any)?.details;
            if (output?.ref === ref && output.stageId === stageId) known = true;
          }
        }
        if (!task && known && events.length < 500)
          return result(
            {
              status: 'unavailable',
              ref,
              error:
                '当前进程无法确认后台任务状态，且尚无完成回执；请先核查原任务，不要自动重新生成',
            },
            true,
          );
        if (!task && !known && events.length < 500)
          return result(
            {
              status: 'unavailable',
              error: '该视频任务不存在于当前会话；不能伪造素材或假定任务完成',
              ref,
            },
            true,
          );
        if (events.length >= 500) continue;
        await delay(1000, undefined, { signal: combined });
      }
      return result({ status: 'generating', ref, instruction: '继续等待同一 ref，不要重复生成' });
    },
  };
}
