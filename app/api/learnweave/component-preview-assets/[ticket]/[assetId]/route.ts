import type { NextRequest } from 'next/server';
import { learnweaveEnabled } from '@/extensions/learnweave/config';
import { previewAsset } from '@/extensions/learnweave/components/hosted-previews';
import { ProductionError } from '@/extensions/learnweave/client';
export const runtime = 'nodejs';
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticket: string; assetId: string }> },
) {
  if (!learnweaveEnabled()) return new Response('Not found', { status: 404 });
  const { ticket, assetId } = await params;
  try {
    const asset = await previewAsset(ticket, assetId);
    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        'Content-Type': asset.mimeType,
        'X-Asset-Revision': asset.revision,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    return new Response('预览素材不可用', {
      status: e instanceof ProductionError ? e.status : 503,
    });
  }
}
