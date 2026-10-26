export interface AssetSlot {
  path: string;
  kind: 'image' | 'video' | 'audio';
}
export interface ComponentDefinition {
  componentRef: { id: string; version: string };
  contentSchema: Record<string, unknown>;
  assetSlots: AssetSlot[];
}
/** Resolve declared JSON-pointer fields, with * for array/object members. Never scan description text. */
export function componentAssets(props: unknown, slots: readonly AssetSlot[]) {
  const out: { path: string; kind: AssetSlot['kind']; ref: string }[] = [];
  const escape = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');
  for (const slot of slots) {
    if (!slot || !['image', 'video', 'audio'].includes(slot.kind) || !/^\//.test(slot.path))
      throw Error('组件素材字段描述无效');
    const visit = (value: unknown, parts: string[], path: string) => {
      if (!parts.length) {
        if (value === undefined || value === null) return;
        if (typeof value !== 'string') throw Error('素材引用必须为 string');
        if (value) out.push({ path, kind: slot.kind, ref: value });
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
    visit(props, slot.path.slice(1).split('/'), '');
  }
  return out;
}
