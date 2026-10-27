'use client';
import { useEffect, useRef, useState } from 'react';
import type { Scene } from '@/lib/types/stage';
import { useStageStore } from '@/lib/store/stage';
import { componentAssets } from './protocol';
type Hosted = {
  id: string;
  url: string;
  thumbnailUrl: string;
  expiresAt: number;
  sceneId: string;
  stageId: string;
  signature: string;
  assetSlots: import('./protocol').AssetSlot[];
};
const thumbnails = new Map<string, Promise<Hosted>>();
function useHosted(scene: Scene, mode: 'view' | 'edit' | 'thumbnail', visible = true) {
  const [hosted, setHosted] = useState<Hosted>(),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const signature = JSON.stringify(scene.content),
    echo = useRef(''),
    lastScene = useRef(scene.id);
  if (lastScene.current !== scene.id) {
    lastScene.current = scene.id;
    echo.current = '';
  }
  useEffect(() => {
    if (!visible || scene.content.type !== 'component' || signature === echo.current) return;
    const ac = new AbortController();
    setError('');
    if (mode !== 'thumbnail') setHosted(undefined);
    const key = JSON.stringify([scene.stageId, scene.id, signature, mode]);
    const load = async () => {
      const r = await fetch('/api/learnweave/component-previews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stageId: scene.stageId,
          sceneId: scene.id,
          content: JSON.parse(signature),
          mode,
        }),
        signal:
          mode === 'thumbnail'
            ? AbortSignal.timeout(30000)
            : AbortSignal.any([ac.signal, AbortSignal.timeout(30000)]),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.message || 'LearnWeave 预览暂不可用');
      return { ...data, sceneId: scene.id, stageId: scene.stageId, signature } as Hosted;
    };
    let task: Promise<Hosted>;
    if (mode === 'thumbnail') {
      task = (thumbnails.get(key) || load()).then((value) =>
        value.expiresAt <= Date.now() ? load() : value,
      );
      thumbnails.set(key, task);
      if (thumbnails.size > 100) thumbnails.delete(thumbnails.keys().next().value!);
      void task
        .then((value) => {
          if (value.expiresAt <= Date.now()) thumbnails.delete(key);
        })
        .catch(() => thumbnails.delete(key));
    } else task = load();
    void task
      .then((value) => {
        if (!ac.signal.aborted) {
          setHosted(value);
          setError('');
        }
      })
      .catch((e) => {
        if (!ac.signal.aborted) setError(e.message);
      });
    return () => ac.abort();
  }, [scene.stageId, scene.id, signature, mode, visible, retry]);
  return {
    hosted,
    error,
    setError,
    echo,
    retry: () => {
      thumbnails.clear();
      setRetry((n) => n + 1);
    },
  };
}
export function ComponentSceneView({
  scene,
  editing = false,
}: {
  scene: Scene;
  editing?: boolean;
}) {
  const {
    hosted: loaded,
    error,
    setError,
    echo,
    retry,
  } = useHosted(scene, editing ? 'edit' : 'view');
  const hosted =
    loaded?.sceneId === scene.id && loaded.stageId === scene.stageId ? loaded : undefined;
  const frame = useRef<HTMLIFrameElement>(null),
    accepted = useRef({ id: '', revision: 0 }),
    ready = useRef(''),
    [raw, setRaw] = useState('');
  useEffect(() => {
    setRaw(JSON.stringify(scene.content.type === 'component' ? scene.content.props : {}, null, 2));
  }, [scene.content]);
  useEffect(() => {
    if (!hosted) return;
    ready.current = '';
    const timer = setTimeout(() => {
      if (ready.current !== hosted.id)
        setError('LearnWeave 预览未能连接，可重试或继续编辑 JSON 内容');
    }, 20000);
    return () => clearTimeout(timer);
  }, [hosted?.id, setError]);
  useEffect(() => {
    if (!hosted) return;
    if (accepted.current.id !== hosted.id) accepted.current = { id: hosted.id, revision: 0 };
    const origin = new URL(hosted.url).origin;
    function receive(event: MessageEvent) {
      if (
        (hosted!.signature !== JSON.stringify(scene.content) &&
          echo.current !== JSON.stringify(scene.content)) ||
        event.source !== frame.current?.contentWindow ||
        event.origin !== origin ||
        !event.data ||
        event.data.id !== hosted!.id
      )
        return;
      if (event.data.type === 'learnweave.component-preview.ready') {
        ready.current = hosted!.id;
        setError('');
        return;
      }
      if (
        !editing ||
        event.data.type !== 'learnweave.component-preview.changed' ||
        !Number.isInteger(event.data.revision) ||
        event.data.revision <= accepted.current.revision ||
        scene.content.type !== 'component'
      )
        return;
      const data = event.data;
      if (
        JSON.stringify(data.componentRef) !== JSON.stringify(scene.content.componentRef) ||
        !data.props ||
        typeof data.props !== 'object' ||
        Array.isArray(data.props) ||
        JSON.stringify(data.props).length > 100000
      )
        return;
      accepted.current = { id: hosted!.id, revision: data.revision };
      const content = { ...scene.content, props: data.props };
      const assets = (props: Record<string, unknown>) => {
        try {
          return JSON.stringify(
            componentAssets(props, hosted!.assetSlots)
              .map((a) => a.ref)
              .sort(),
          );
        } catch {
          return '';
        }
      };
      if (assets(scene.content.props) === assets(data.props))
        echo.current = JSON.stringify(content);
      useStageStore.getState().updateScene(scene.id, { content });
    }
    // Register before asking the child to acknowledge: cached iframe modules can
    // finish before a passive effect receives the child's initial ready event.
    window.addEventListener('message', receive);
    const connect = () => {
      if (ready.current !== hosted.id)
        frame.current?.contentWindow?.postMessage(
          { type: 'learnweave.component-preview.connect', id: hosted.id },
          origin,
        );
    };
    connect();
    const reconnect = setInterval(connect, 500);
    return () => {
      clearInterval(reconnect);
      window.removeEventListener('message', receive);
    };
  }, [hosted?.id, hosted?.url, editing, scene.id, scene.content, setError, echo]);
  if (scene.content.type !== 'component') return null;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        minHeight: 220,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
      }}
    >
      {hosted && !error ? (
        <iframe
          key={hosted.id}
          ref={frame}
          title={editing ? 'LearnWeave 组件编辑预览' : 'LearnWeave 组件预览'}
          src={hosted.url}
          style={{ width: '100%', flex: 1, minHeight: 220, border: 0 }}
          sandbox="allow-scripts allow-same-origin allow-forms"
          allow="autoplay; microphone"
          referrerPolicy="no-referrer"
          onError={() => setError('LearnWeave 预览暂不可用')}
        />
      ) : (
        <div role={error ? 'alert' : 'status'}>
          {error || '正在连接 LearnWeave 预览…'}
          {error && <button onClick={retry}>重新连接预览</button>}
        </div>
      )}
      {editing && (
        <details open={!!error}>
          <summary>编辑内容 JSON</summary>
          <textarea
            aria-label="组件内容 JSON"
            value={raw}
            style={{ width: '100%', minHeight: 160 }}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={() => {
              try {
                const props = JSON.parse(raw);
                if (!props || typeof props !== 'object' || Array.isArray(props)) throw Error();
                useStageStore.getState().updateScene(scene.id, {
                  content: { ...scene.content, props } as typeof scene.content,
                });
              } catch {
                setError('内容必须为有效 JSON 对象');
              }
            }}
          />
          <p>修改后需重新保存活动清单才能导出。</p>
        </details>
      )}
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
  const { hosted: loaded, error, setError } = useHosted(scene, 'thumbnail', visible);
  const hosted =
    loaded?.sceneId === scene.id && loaded.stageId === scene.stageId ? loaded : undefined;
  if (scene.content.type !== 'component' || !visible) return <div aria-label="组件缩略图" />;
  return hosted && !error ? (
    <img
      src={hosted.thumbnailUrl}
      alt="LearnWeave 组件缩略图"
      loading="lazy"
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      onError={() => setError('缩略图暂不可用')}
    />
  ) : (
    <div aria-label="组件缩略图">{error ? '预览不可用' : '正在准备预览'}</div>
  );
}
