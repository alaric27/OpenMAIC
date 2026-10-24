/** Single-page component content. Component contracts validate props separately. */
export type ComponentValue =
  | null
  | boolean
  | number
  | string
  | ComponentValue[]
  | { [key: string]: ComponentValue };
export interface ComponentContent {
  type: 'component';
  componentRef: { id: string; version: string };
  props: { [key: string]: ComponentValue };
  /** Derived resource-field snapshot, not authored teaching content. Paths are relative to props. */
  assetSlots?: { path: string; kind: 'image' | 'video' | 'audio' }[];
}

/** Generic persisted resource paths. Legacy v0.13 documents keep their original two reserved slots. */
export function componentAssetReferences(content: ComponentContent) {
  const slots = content.assetSlots ?? [
    { path: '/imageUrl', kind: 'image' as const },
    { path: '/videoUrl', kind: 'video' as const },
  ];
  const refs: { path: string; kind: 'image' | 'video' | 'audio'; ref: string }[] = [];
  const escape = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');
  for (const slot of slots) {
    if (!slot || !['image', 'video', 'audio'].includes(slot.kind) || !slot.path?.startsWith('/'))
      throw Error('Invalid component asset slot');
    const visit = (value: unknown, parts: string[], path: string) => {
      if (!parts.length) {
        if (typeof value === 'string' && value) refs.push({ path, kind: slot.kind, ref: value });
        return;
      }
      if (!value || typeof value !== 'object') return;
      const [part, ...rest] = parts;
      if (part === '*')
        for (const [key, child] of Object.entries(value))
          visit(child, rest, path + '/' + escape(key));
      else {
        const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
        if (Object.hasOwn(value, key))
          visit((value as Record<string, unknown>)[key], rest, path + '/' + escape(key));
      }
    };
    visit(content.props, slot.path.slice(1).split('/'), '');
  }
  return refs;
}
