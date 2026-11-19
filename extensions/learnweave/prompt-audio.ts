import { Type, type Static } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { synthesizeClassroomPrompt } from '@/lib/server/agent-runtime/scene-tts';
import type { ToolDeps } from './adapter';

const params = Type.Object(
  {
    stageId: Type.String({ pattern: '^[A-Za-z0-9_-]{1,128}$' }),
    language: Type.String({ pattern: '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$' }),
    text: Type.String({ pattern: '\\S', maxLength: 1000 }),
  },
  { additionalProperties: false },
);

export function promptAudioTool(deps: ToolDeps): AgentTool {
  return {
    name: 'lw_generate_prompt_audio',
    label: '生成听选题干音频',
    description:
      'Synthesize a listening quiz prompt in the configured server TTS. Bind the returned promptAudioAssetId verbatim to the quiz activity data.promptAudioAssetId in lw_save_course. Keep the spoken stimulus out of the quiz scene and do not create narration actions.',
    parameters: params,
    async execute(_callId, raw, signal) {
      const input = raw as Static<typeof params>;
      const activeSignals = [signal, deps.abortSignal].filter((s): s is AbortSignal => !!s);
      const combined = activeSignals.length ? AbortSignal.any(activeSignals) : undefined;
      const promptAudioAssetId = await synthesizeClassroomPrompt({
        ...input,
        ownerId: await deps.currentOwner(),
        signal: combined,
      });
      const details = { promptAudioAssetId };
      return { details, content: [{ type: 'text', text: JSON.stringify(details) }] };
    },
  };
}
