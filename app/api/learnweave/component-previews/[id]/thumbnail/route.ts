import type { NextRequest } from 'next/server';
import { withRequestOwner } from '@/extensions/learnweave/adapter';
import { learnweaveEnabled } from '@/extensions/learnweave/config';
import { hostedThumbnail } from '@/extensions/learnweave/components/hosted-previews';
import { ProductionError } from '@/extensions/learnweave/client';
export const runtime = 'nodejs';
export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!learnweaveEnabled()) return new Response('Not found', { status: 404 });
  return withRequestOwner(req, async ({ ownerId }, headers) => {
    try {
      const result = await hostedThumbnail(ownerId, (await params).id);
      headers.set('Content-Type', 'image/svg+xml');
      headers.set('Cache-Control', 'private, max-age=60');
      headers.set('Content-Security-Policy', "default-src 'none'; img-src data:; sandbox");
      return new Response(result, { headers });
    } catch (e) {
      return new Response('预览缩略图不可用', {
        status: e instanceof ProductionError ? e.status : 503,
        headers,
      });
    }
  });
}
