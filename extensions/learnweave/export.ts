import type { NextRequest } from 'next/server';
import {
  withRequestOwner,
  getOwnerScopedDocumentStore,
  probeStageAccess,
  ownerJson,
  ownerNotFound,
} from './adapter';
import { learnweaveEnabled } from './config';
import { readTemplates } from './store';
import { checkedManifest, bindingFingerprint } from './validate';

export async function exportBundle(req: NextRequest, stageId: string) {
  if (!learnweaveEnabled()) return new Response('Not found', { status: 404 });
  return withRequestOwner(req, async ({ ownerId }, headers) => {
    if ((await probeStageAccess(ownerId, stageId)).kind !== 'owned') return ownerNotFound(headers);
    const store = await getOwnerScopedDocumentStore(ownerId);
    const before = await store.readFreshnessManifest(stageId);
    const row = await readTemplates(stageId);
    if (!row) return new Response(null, { status: 204, headers });
    if (row.status !== 'ready')
      return ownerJson({ message: '模板保存未完成，请读取活动并重试保存。' }, 409, headers);
    const document = await store.loadDocument(stageId);
    if (!document) return ownerNotFound(headers);
    try {
      checkedManifest(row.manifest, document);
      if (bindingFingerprint(row.manifest, document) !== row.fingerprint)
        throw new Error('原生题目或素材已改变，请在工作台重新保存对应模板活动。');
      const after = await store.readFreshnessManifest(stageId);
      const current = await readTemplates(stageId);
      if (
        JSON.stringify(before) !== JSON.stringify(after) ||
        row.revision !== current?.revision ||
        current.status !== 'ready'
      )
        throw new Error('课程正在变化，请稍后重试。');
      return ownerJson(
        { document, learning: row.manifest, nativeRevision: after?.rev },
        200,
        headers,
      );
    } catch (e) {
      return ownerJson({ message: e instanceof Error ? e.message : '模板配置无效' }, 409, headers);
    }
  });
}
