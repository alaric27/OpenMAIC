import type { NextRequest } from 'next/server';
import {
  withRequestOwner,
  ownerJson,
  ownerNotFound,
  probeStageAccess,
} from '@/extensions/learnweave/adapter';
import { learnweaveEnabled } from '@/extensions/learnweave/config';
import { hostedPreview } from '@/extensions/learnweave/components/hosted-previews';
import { ProductionError } from '@/extensions/learnweave/client';
export const runtime = 'nodejs';
export function POST(req: NextRequest) {
  if (!learnweaveEnabled()) return new Response('Not found', { status: 404 });
  return withRequestOwner(req, async ({ ownerId }, headers) => {
    try {
      const parent = new URL(
        req.headers.get('origin') || `${req.nextUrl.protocol}//${req.headers.get('host')}`,
      );
      if (
        !['http:', 'https:'].includes(parent.protocol) ||
        parent.host !== req.headers.get('host') ||
        parent.username ||
        parent.password ||
        parent.pathname !== '/' ||
        parent.search ||
        parent.hash
      )
        throw new ProductionError('预览请求来源无效', 403);
      if (Number(req.headers.get('content-length')) > 200000)
        throw new ProductionError('预览请求过大');
      const body = await req.json();
      if (
        typeof body.stageId !== 'string' ||
        (await probeStageAccess(ownerId, body.stageId)).kind !== 'owned'
      )
        return ownerNotFound(headers);
      return ownerJson(await hostedPreview(ownerId, parent.origin, body), 200, headers);
    } catch (e) {
      return ownerJson(
        { message: e instanceof Error ? e.message : '预览暂不可用' },
        e instanceof ProductionError ? e.status : 503,
        headers,
      );
    }
  });
}
