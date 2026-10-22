import type { CourseDocument } from './adapter';
import { assertOwnedAssets } from './adapter';
import { sourceAssetId } from './templates';
import { boundAssets } from './contracts/template-bindings';
import type { TemplateManifest } from './contracts/generated';

/** Validate bytes' metadata, not just the DSL element type (including older saved courses). */
export async function assertManifestAssets(
  ownerId: string,
  manifest: TemplateManifest,
  doc: CourseDocument,
) {
  const assets: { id: string; kind: string; field: string }[] = [];
  for (const activity of manifest.activities) {
    const page = doc.scenes.find((s) => s.id === activity.contentRef);
    if (page?.content.type !== 'slide') continue; // checkedManifest reports missing bindings.
    for (const { id, kind } of boundAssets(activity)) {
      const element = page.content.canvas.elements.find((e) => e.id === id);
      if (element && 'src' in element && typeof element.src === 'string') {
        assets.push({ id: sourceAssetId(element.src), kind, field: `${activity.id}.${id}` });
      }
    }
  }
  await assertOwnedAssets(ownerId, assets);
}
