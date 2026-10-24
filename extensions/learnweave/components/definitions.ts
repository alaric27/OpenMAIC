import {
  assetSlots,
  componentContract,
  type ComponentDefinition,
} from '@openmaic/scene-components';
import { ProductionError } from '../client';
import type { ProductionSpec } from '../transport-types';
/** Published LearnWeave metadata is authoritative. Defaults only support pre-metadata template revisions. */
export function definitionFromTemplate(template: Record<string, any>): ComponentDefinition {
  const ref = template.componentRef;
  if (template.sceneType !== 'component' || !ref?.id || !ref?.version)
    throw new ProductionError('已发布组件模板不存在');
  const legacy = componentContract(ref);
  const schema = template.contentSchema;
  const slots = template.assetSlots ?? (legacy ? assetSlots(ref) : undefined);
  if (!schema || typeof schema !== 'object' || !Array.isArray(slots))
    throw new ProductionError('模板缺少内容 Schema 或素材字段描述');
  if (
    slots.some(
      (s) =>
        !s ||
        typeof s.path !== 'string' ||
        !s.path.startsWith('/') ||
        !['image', 'video', 'audio'].includes(s.kind),
    )
  )
    throw new ProductionError('模板素材字段描述无效');
  return { componentRef: ref, contentSchema: schema, assetSlots: slots };
}
export function definitionFor(spec: ProductionSpec, ref: { id: string; version: string }) {
  const template = [...spec.templateVersions].reverse().find((t) => {
    const value = t.value as Record<string, any>;
    return (
      value.sceneType === 'component' &&
      value.componentRef?.id === ref.id &&
      value.componentRef?.version === ref.version
    );
  })?.value;
  if (!template) throw new ProductionError('LearnWeave 未发布该组件版本');
  return definitionFromTemplate(template);
}
