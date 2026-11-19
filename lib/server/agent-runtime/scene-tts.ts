import { authorizeMediaModel } from '@/lib/server/model-config/media';
import { DEFAULT_TTS_MODELS, DEFAULT_TTS_VOICES, TTS_PROVIDERS } from '@/lib/audio/constants';
import { generateTTS, TTSRequestTimeoutError } from '@/lib/audio/tts-providers';
import type { TTSModelConfig, TTSProviderId } from '@/lib/audio/types';
import { BROWSER_NATIVE_TTS_PROVIDER_ID } from '@/lib/audio/provider-enablement';
import type { LegacySpeechAction, SpeechAction } from '@/lib/types/action';
import type { GeneratedAgentConfig, Scene } from '@/lib/types/stage';
import { adapterOptions } from '@/lib/server/model-config/adapter-options';
import { serverMediaConnection } from '@/lib/server/model-config/media';
import { resolveTTSModel, slotTTSModel } from '@/lib/server/provider-config';
import { persistClassroomMediaBytes } from '@/lib/server/classroom-media-bytes';

export interface SceneTtsSummary {
  available: boolean;
  changed: boolean;
  generated: number;
  skipped: number;
  failed: string[];
}

export interface SceneTtsInput {
  scene: Scene;
  force: boolean;
  roster?: readonly GeneratedAgentConfig[] | null;
  signal?: AbortSignal;
  /** The run's owner, whose tts slot applies. */
  ownerId?: string;
}

function narratorVoice(roster: SceneTtsInput['roster']) {
  return roster?.find((agent) => agent.role === 'teacher' && agent.voiceConfig)?.voiceConfig;
}

function audioMime(format: string) {
  return format === 'wav' ? 'audio/wav' : format === 'ogg' ? 'audio/ogg' : 'audio/mpeg';
}

async function narrationConfig(
  ownerId?: string,
  bound?: ReturnType<typeof narratorVoice>,
  language?: string,
): Promise<TTSModelConfig | undefined> {
  const connection = await serverMediaConnection('tts', ownerId);
  if (
    !connection ||
    connection === 'off' ||
    connection.providerId === BROWSER_NATIVE_TTS_PROVIDER_ID
  ) {
    return;
  }
  const providerId = connection.providerId as TTSProviderId;
  const provider = TTS_PROVIDERS[providerId as keyof typeof TTS_PROVIDERS];
  const apiKey = connection.apiKey ?? '';
  if (provider?.requiresApiKey && !apiKey) {
    return;
  }
  const locale = language?.toLowerCase();
  const translatedVoice =
    locale &&
    (provider?.voices.find((voice) => voice.language?.toLowerCase() === locale) ||
      provider?.voices.find(
        (voice) => voice.language?.split('-')[0]?.toLowerCase() === locale.split('-')[0],
      ));
  const voice =
    bound?.providerId === providerId && bound.voiceId
      ? bound.voiceId
      : (translatedVoice ? translatedVoice.id : undefined) ||
        DEFAULT_TTS_VOICES[providerId as keyof typeof DEFAULT_TTS_VOICES] ||
        '';
  const model =
    connection.modelId ?? (DEFAULT_TTS_MODELS[providerId as keyof typeof DEFAULT_TTS_MODELS] || '');
  // A configured slot's own model; the legacy server pins apply only to a default.
  const modelId =
    (connection.origin === 'configuration'
      ? slotTTSModel(providerId, model, voice)
      : resolveTTSModel(providerId, model, voice)) || '';
  authorizeMediaModel(connection, 'tts', modelId);
  return {
    providerId,
    modelId,
    apiKey,
    baseUrl: connection.baseUrl,
    managed: connection.managed,
    publicOnly: connection.userEndpoint,
    voice,
    providerOptions: adapterOptions(connection),
  };
}

export async function synthesizeClassroomPrompt(input: {
  stageId: string;
  ownerId: string;
  language: string;
  text: string;
  signal?: AbortSignal;
}): Promise<string> {
  const config = await narrationConfig(input.ownerId, undefined, input.language);
  if (!config) throw Error('当前作者没有可用的服务端 TTS');
  const audio = await generateTTS({ ...config, signal: input.signal }, input.text);
  if (!['mp3', 'wav', 'ogg'].includes(audio.format) || !audio.audio.length)
    throw Error('题干 TTS 未返回受支持的非空音频');
  return persistClassroomMediaBytes({
    stageId: input.stageId,
    bytes: audio.audio,
    mime: audioMime(audio.format),
    prefix: 'tts-prompt',
    signal: input.signal,
  });
}

/** Server-configured narration synthesis into the stage's classroom-media path. */
export async function synthesizeSceneNarration(input: SceneTtsInput): Promise<SceneTtsSummary> {
  const config = await narrationConfig(input.ownerId, narratorVoice(input.roster));
  if (!config) return { available: false, changed: false, generated: 0, skipped: 0, failed: [] };
  let generated = 0;
  let skipped = 0;
  const failed: string[] = [];
  for (const action of input.scene.actions ?? []) {
    if (action.type !== 'speech' || !(action as SpeechAction).text) continue;
    const speech = action as SpeechAction;
    if (!input.force && speech.audioId) {
      skipped += 1;
      continue;
    }
    if (input.signal?.aborted) throw new Error('aborted');
    try {
      const audio = await generateTTS(
        {
          ...config,
          speed: speech.speed,
          signal: input.signal,
        },
        speech.text,
      );
      if (input.signal?.aborted) throw new Error('aborted');
      // The persisted reference is the RELATIVE classroom-media path (the
      // agent runtime has no request origin; relative stays valid on any
      // deployment origin — see classroom-media-bytes.ts). The browser's
      // narration consumers (timeline status/preview, playback, exports)
      // resolve a speech line through the legacy (audioId, audioUrl) pair:
      // `audioId` alone is never resolvable to bytes client-side, while a
      // present `audioUrl` marks the line voiced and is what the audio
      // element / fetch fallback plays. Stamp the same relative path on both.
      const audioId = await persistClassroomMediaBytes({
        stageId: input.scene.stageId,
        bytes: Buffer.from(audio.audio),
        mime: audioMime(audio.format),
        prefix: `tts-${action.id}`,
        signal: input.signal,
      });
      speech.audioId = audioId;
      (speech as LegacySpeechAction).audioUrl = audioId;
      generated += 1;
    } catch (error) {
      if (input.signal?.aborted) throw error;
      // A hung provider must fail the tool call with the retryable timeout
      // error instead of degrading into a per-action failure: the remaining
      // actions would hit the same hung upstream and the session would wedge.
      if (error instanceof TTSRequestTimeoutError) throw error;
      failed.push(action.id);
    }
  }
  return {
    available: true,
    changed: generated > 0,
    generated,
    skipped,
    failed,
  };
}
