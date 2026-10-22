import { generateTTS } from '@/lib/audio/tts-providers';
import { DEFAULT_TTS_MODELS, DEFAULT_TTS_VOICES } from '@/lib/audio/constants';
import type { TTSProviderId } from '@/lib/audio/types';
import { serverMediaConnection, authorizeMediaModel, adapterOptions } from '@/lib/server/model-config/media';
import { resolveTTSModel, slotTTSModel } from '@/lib/server/provider-config';
import { storeGeneratedAssetOrThrow } from '@/lib/server/store-generated-asset';
import type { Queryable } from '@openmaic/storage/document/pg';

export async function promptAudio(text: string, stageId: string, ownerId: string, signal: AbortSignal | undefined, fence: (tx: Queryable) => Promise<void>) {
  const connection = await serverMediaConnection('tts', ownerId);
  if (!connection || connection === 'off' || connection.providerId === 'browser-native-tts') throw new Error('Configure server TTS or supply an existing audioSrc');
  const providerId = connection.providerId as TTSProviderId;
  const voice = DEFAULT_TTS_VOICES[providerId as keyof typeof DEFAULT_TTS_VOICES] || '';
  const model = connection.modelId || DEFAULT_TTS_MODELS[providerId as keyof typeof DEFAULT_TTS_MODELS] || '';
  const modelId = (connection.origin === 'configuration' ? slotTTSModel(providerId, model, voice) : resolveTTSModel(providerId, model, voice)) || '';
  authorizeMediaModel(connection, 'tts', modelId);
  const audio = await generateTTS({ providerId, modelId, voice, apiKey: connection.apiKey || '', baseUrl: connection.baseUrl, managed: connection.managed, publicOnly: connection.userEndpoint, providerOptions: adapterOptions(connection), signal }, text);
  signal?.throwIfAborted();
  return storeGeneratedAssetOrThrow({ ownerId, stageId, kind: 'audio', bytes: new Uint8Array(audio.audio), mimeType: audio.format === 'wav' ? 'audio/wav' : audio.format === 'ogg' ? 'audio/ogg' : 'audio/mpeg', fence });
}
