import type { NextRequest } from 'next/server';
import { productionJobRoute } from '@/extensions/learnweave/job-routes';
export const runtime = 'nodejs';
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return productionJobRoute(req, (await params).id, true);
}
