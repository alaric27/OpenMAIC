import type { NextRequest } from 'next/server';
import { withRequestOwner, ownerJson } from '@/extensions/learnweave/adapter';
import { learnweaveEnabled } from '@/extensions/learnweave/config';
import { productionSpec, ProductionError } from '@/extensions/learnweave/client';
import { definitionFromTemplate } from '@/extensions/learnweave/components/definitions';
export const runtime = 'nodejs';
export function GET(req: NextRequest) {
  if (!learnweaveEnabled()) return new Response('Not found', { status: 404 });
  return withRequestOwner(req, async (_owner, headers) => {
    try {
      const spec = await productionSpec();
      const definitions = spec.templateVersions
        .filter((t) => (t.value as any).sceneType === 'component')
        .map((t) => ({
          templateId: t.value.id,
          revision: t.revision,
          ...definitionFromTemplate(t.value),
        }));
      return ownerJson({ definitions }, 200, headers);
    } catch (e) {
      return ownerJson(
        { message: e instanceof Error ? e.message : '无法读取模板定义' },
        e instanceof ProductionError ? e.status : 503,
        headers,
      );
    }
  });
}
