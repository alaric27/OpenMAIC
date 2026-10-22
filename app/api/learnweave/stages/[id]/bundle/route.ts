import type { NextRequest } from 'next/server';
import { exportBundle } from '@/extensions/learnweave/export';
export const runtime = 'nodejs';
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return exportBundle(req, (await params).id);
}
