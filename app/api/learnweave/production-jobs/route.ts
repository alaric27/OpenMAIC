import type { NextRequest } from 'next/server';
import { productionJobRoute } from '@/extensions/learnweave/job-routes';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  return productionJobRoute(req);
}
