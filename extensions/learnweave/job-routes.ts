import type { NextRequest } from 'next/server';
import { withRequestOwner, ownerJson } from './adapter';
import { learnweaveEnabled } from './config';
import { ProductionError } from './client';
import {
  parseJobRequest,
  submitProductionJob,
  readProductionJob,
  cancelProductionJob,
} from './jobs';
import { isAgentRuntimeConfigured } from '@/lib/config/feature-flags';
import { assertWorkspaceModelsAuthorized } from '@/lib/server/model-config/runtime';
import { findSkill } from '@/lib/server/agent-runtime/skills';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import { ownerWriteErrorResponse } from '@/lib/persistence/owner-merges';

export async function productionJobRoute(req: NextRequest, key?: string, cancel = false) {
  if (!learnweaveEnabled() || !isAgentRuntimeConfigured())
    return new Response('Not found', { status: 404 });
  return withRequestOwner(req, async ({ ownerId }, headers) => {
    try {
      if (key)
        return ownerJson(
          await (cancel ? cancelProductionJob(ownerId, key) : readProductionJob(ownerId, key)),
          200,
          headers,
        );
      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        throw new ProductionError('请求必须为 JSON', 400);
      }
      const input = parseJobRequest(raw);
      await assertWorkspaceModelsAuthorized(ownerId, ['agent', 'image', 'video', 'tts']);
      if (!(await findSkill('learnweave-english', ownerId)))
        throw new ProductionError('未安装 learnweave-english 技能', 422);
      return ownerJson(
        await submitProductionJob(ownerId, input, buildRequestOrigin(req)),
        202,
        headers,
      );
    } catch (error) {
      const ownerError = ownerWriteErrorResponse(error, headers);
      if (ownerError) return ownerError;
      return ownerJson(
        { message: error instanceof ProductionError ? error.message : '生产服务暂不可用' },
        error instanceof ProductionError ? error.status : 503,
        headers,
      );
    }
  });
}
