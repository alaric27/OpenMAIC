'use client';
import { useEffect, useState } from 'react';
import { ComponentView, ComponentThumbnail } from '@openmaic/scene-components/react';
import { propsIssue, type ComponentDefinition } from '@openmaic/scene-components';
import type { Scene } from '@/lib/types/stage';
import { useStageStore } from '@/lib/store/stage';
const resolve = (value: string) =>
  /^[A-Za-z0-9_-]+$/.test(value)
    ? `/api/persistence/assets/${encodeURIComponent(value)}/content`
    : value;
function SchemaField({
  name,
  schema,
  value,
  commit,
}: {
  name: string;
  schema: any;
  value: unknown;
  commit: (value: unknown) => void;
}) {
  const string = schema.type === 'string';
  const [draft, setDraft] = useState(
    string ? String(value ?? '') : (JSON.stringify(value, null, 2) ?? ''),
  );
  const [error, setError] = useState('');
  useEffect(
    () => setDraft(string ? String(value ?? '') : (JSON.stringify(value, null, 2) ?? '')),
    [value, string],
  );
  return (
    <label style={{ display: 'block', marginBottom: 16 }}>
      {schema.description || schema.title || name}
      <textarea
        aria-label={schema.description || schema.title || name}
        value={draft}
        style={{ width: '100%', minHeight: 80 }}
        onChange={(e) => {
          setDraft(e.target.value);
          if (string) commit(e.target.value);
        }}
        onBlur={() => {
          if (!string)
            try {
              commit(JSON.parse(draft));
              setError('');
            } catch {
              setError('请输入有效 JSON');
            }
        }}
      />
      {error && <p role="alert">{error}</p>}
    </label>
  );
}
export function ComponentSceneView({
  scene,
  editing = false,
}: {
  scene: Scene;
  editing?: boolean;
}) {
  const [error, setError] = useState('');
  const [definition, setDefinition] = useState<ComponentDefinition>();
  const ref = scene.content.type === 'component' ? scene.content.componentRef : undefined;
  useEffect(() => {
    if (!editing || !ref) return;
    const controller = new AbortController();
    setDefinition(undefined);
    setError('');
    void fetch('/api/learnweave/components', { signal: controller.signal, cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Error(data.message || '模板定义读取失败');
        const d = data.definitions.find(
          (d: ComponentDefinition) =>
            d.componentRef.id === ref.id && d.componentRef.version === ref.version,
        );
        if (!d) throw Error('LearnWeave 未发布该组件版本');
        setDefinition(d);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [editing, ref?.id, ref?.version]);
  if (scene.content.type !== 'component') return null;
  const content = scene.content;
  const commit = (name: string, value: unknown) => {
    if (!definition) return;
    const props = { ...content.props, [name]: value };
    const issue = propsIssue(definition.contentSchema, props);
    if (issue) {
      setError(issue);
      return;
    }
    setError('');
    useStageStore
      .getState()
      .updateScene(scene.id, {
        content: {
          ...content,
          props: props as typeof content.props,
          assetSlots: definition.assetSlots,
        },
      });
  };
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        display: 'grid',
        gridTemplateColumns: editing ? 'minmax(180px, 30%) minmax(0, 1fr)' : '1fr',
        gap: 16,
      }}
    >
      {editing && (
        <div>
          {definition ? (
            Object.entries(
              (definition.contentSchema.properties || {}) as Record<string, unknown>,
            ).map(([name, schema]) => (
              <SchemaField
                key={name}
                name={name}
                schema={schema}
                value={content.props[name]}
                commit={(v) => commit(name, v)}
              />
            ))
          ) : (
            <p>正在读取 LearnWeave 模板定义…</p>
          )}
          <p>修改后需重新保存活动清单才能导出。</p>
        </div>
      )}
      <ComponentView key={scene.id} content={content} resolveAsset={resolve} onError={setError} />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function ComponentSceneThumbnail({
  scene,
  visible = true,
}: {
  scene: Scene;
  visible?: boolean;
}) {
  return scene.content.type === 'component' ? (
    <ComponentThumbnail content={scene.content} resolveAsset={resolve} visible={visible} />
  ) : null;
}
