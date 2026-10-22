import type { CourseDocument } from './adapter';
import { assertOwnedAssets } from './adapter';
import { sourceAssetId } from './templates';
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
    const bindings: [string | undefined, string][] = [];
    if (activity.templateId === 'practice.listen-image') {
      bindings.push(
        [activity.mediaElementId, 'audio'],
        ...Object.values(activity.optionImageElementIds || {}).map((id): [string, string] => [
          id,
          'image',
        ]),
      );
    } else if (activity.templateId === 'practice.image-word')
      bindings.push([activity.imageElementId, 'image']);
    else if (activity.templateId.startsWith('media.'))
      bindings.push([
        activity.mediaElementId,
        activity.templateId === 'media.audio' ? 'audio' : 'video',
      ]);
    for (const [id, kind] of bindings) {
      const element = page.content.canvas.elements.find((e) => e.id === id);
      if (element && 'src' in element && typeof element.src === 'string') {
        assets.push({ id: sourceAssetId(element.src), kind, field: `${activity.id}.${id}` });
      }
    }
  }
  await assertOwnedAssets(ownerId, assets);
}
