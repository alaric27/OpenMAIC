import {
  catalog,
  productionSpec,
  producerInputSchema,
  templateSchema,
  type TemplateStandard,
  type TemplateManifest,
} from './contracts/generated';
export interface ProductionStandards {
  entries: TemplateStandard[];
  versions: TemplateStandard[];
  productionSpec: Record<string, unknown>;
  producerInputSchema: typeof producerInputSchema;
}
/** Bootstrap projection for contract tests. Production always reads the authoritative service. */
export function compiledStandards(): ProductionStandards {
  const entries = Object.entries(catalog).map(([id, policy]) => {
    const branch = templateSchema.anyOf.find(
      (s: any) =>
        s.properties.templateId.const === id ||
        s.properties.templateId.anyOf?.some((v: any) => v.const === id),
    )!;
    const schema = JSON.parse(JSON.stringify(branch));
    delete schema.properties.standard;
    schema.properties.templateId = { type: 'string', const: id };
    return {
      id,
      ...policy,
      version: 1,
      content: productionSpec.content[id as keyof typeof productionSpec.content],
      schema,
    } as TemplateStandard;
  });
  return { entries, versions: entries, productionSpec, producerInputSchema };
}
export async function getProductionStandards(): Promise<ProductionStandards> {
  const base = (process.env.LEARNWEAVE_API_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
  const response = await fetch(`${base}/api/v1/template-standards`, {
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  if (!response.ok)
    throw new Error('LearnWeave 标准服务不可用，请先启动服务；不会退回旧的模板目录。');
  const data = (await response.json()) as ProductionStandards;
  if (!Array.isArray(data.entries) || !data.entries.length || !Array.isArray(data.versions))
    throw new Error('LearnWeave 标准服务返回了无效目录');
  return data;
}
export function resolveStandard(standards: ProductionStandards, id: string, version?: number) {
  const entry =
    version === undefined
      ? standards.entries.find((e) => e.id === id)
      : standards.versions.find((e) => e.id === id && e.version === version);
  if (!entry) throw new Error(`LearnWeave 模板 ${id}${version ? ` v${version}` : ''} 尚未发布`);
  return entry;
}
const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export function assertManifestStandards(
  manifest: TemplateManifest,
  standards: ProductionStandards,
) {
  for (const activity of manifest.activities) {
    const entry = resolveStandard(standards, activity.templateId, activity.templateVersion);
    if (
      activity.standard &&
      JSON.stringify(canonical(activity.standard)) !== JSON.stringify(canonical(entry))
    )
      throw new Error(`Activity ${activity.id}: published template snapshot mismatch`);
  }
}
