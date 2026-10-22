/** Local integration fixture: invokes the real tools with saved media, without model requests. */
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { probeStageAccess } from '@/lib/server/agent-runtime/curriculum-tools';
import { buildLearnWeaveTools } from '@/extensions/learnweave';
import { readTemplates } from '@/extensions/learnweave/store';

it.skipIf(!process.env.LEARNWEAVE_TEMPLATE_FIXTURE)('seed real template tool fixture without model requests', async () => {
  process.env.LEARNWEAVE_EXTENSION_ENABLED = 'true';
  const input = JSON.parse(readFileSync(process.env.LEARNWEAVE_TEMPLATE_FIXTURE!, 'utf8')) as { stageId: string; imageIds: string[]; audioId: string };
  const provider = await getServerPersistenceProvider(process.env.DATABASE_URL || '');
  const row = await provider.pool.query('SELECT owner_id FROM stage_meta WHERE stage_id=$1 AND deleted_at IS NULL', [input.stageId]);
  const ownerId = row.rows[0]?.owner_id as string;
  if (!ownerId) throw new Error('Fixture course missing');
  const tools = await buildLearnWeaveTools({ store: await getOwnerScopedDocumentStore(ownerId), ownerId, currentOwner: async () => ownerId, stageAccess: (id) => probeStageAccess(ownerId, id), onCheckpoint: () => undefined, fence: async () => undefined });
  const tool = tools.find((t) => t.name === 'lw_upsert_activity')!;
  const steps = [
    { activityId: 'intro', title: '欢迎来到食物厨房', templateId: 'teaching.picture-talk', contentRef: 'page-1' },
    { activityId: 'learn', title: '看图学单词', templateId: 'teaching.picture-talk', contentRef: 'page-1' },
    { activityId: 'listen', title: '听一听，找到食物', templateId: 'practice.listen-image', audioSrc: input.audioId, answer: 'A', options: [{ value: 'A', label: 'apple', imageSrc: input.imageIds[0] }, { value: 'B', label: 'bread', imageSrc: input.imageIds[1] }] },
    { activityId: 'word', title: '看图片，选择单词', templateId: 'practice.image-word', imageSrc: input.imageIds[0], answer: 'A', options: [{ value: 'A', label: 'apple' }, { value: 'B', label: 'bread' }] },
    { activityId: 'audio', title: '听一段复习音频', templateId: 'media.audio', contentRef: 'page-1', mediaElementId: 'sample' },
    { activityId: 'closing', title: '和老师说一说', templateId: 'teaching.picture-talk', contentRef: 'page-1' },
  ];
  for (const [order, step] of steps.entries()) {
    const result = await tool.execute(`fixture-${step.activityId}`, { ...step, stageId: input.stageId, order, hints: ['再观察一下'], maxAttempts: 3, expectedRevision: (await readTemplates(input.stageId))?.revision ?? 0 }, new AbortController().signal);
    if ('isError' in result && result.isError) throw new Error(JSON.stringify(result.details));
  }
  await provider.pool.end();
}, 30000);
