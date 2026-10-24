'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  componentIssue,
  type ComponentContent,
  type PictureProps,
  type VideoProps,
} from './contracts.js';
const frame: CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: 220,
  boxSizing: 'border-box',
  borderRadius: 24,
  background: '#fffaf0',
  padding: 'clamp(16px, 3vw, 36px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  overflow: 'auto',
  color: '#253e35',
};
function MediaComponentView({
  content,
  resolveAsset,
  disabled = false,
  autoPlay = false,
  onReady,
  onEnded,
  onError,
  position = 0,
  onProgress,
}: {
  content: ComponentContent;
  resolveAsset: (ref: string) => string;
  disabled?: boolean;
  autoPlay?: boolean;
  onReady?: () => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
  position?: number;
  onProgress?: (position: number) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const resume = useRef(false);
  const [blocked, setBlocked] = useState(false);
  const [retry, setRetry] = useState(0);
  const latest = useRef({ onReady, onEnded, onError, onProgress });
  latest.current = { onReady, onEnded, onError, onProgress };
  const issue = componentIssue(content);
  const video = content.componentRef.id === 'video-player';
  const props = content.props as unknown as PictureProps & VideoProps;
  const url = issue ? '' : resolveAsset(video ? props.videoUrl : props.imageUrl);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (disabled) {
      resume.current = !el.paused;
      el.pause();
    } else if (resume.current) {
      resume.current = false;
      void el.play().catch(() => setBlocked(true));
    }
  }, [disabled]);
  useEffect(() => {
    const el = ref.current;
    return () => {
      el?.pause();
    };
  }, [url, retry]);
  if (issue) return <div role="alert">{issue}</div>;
  const failed = () => latest.current.onError?.('素材加载失败，请重试');
  return (
    <section style={frame} aria-label={video ? '视频播放' : '看图教学'}>
      {video ? (
        <>
          <video
            key={`${url}:${retry}`}
            ref={ref}
            src={url}
            controls
            playsInline
            aria-label="教学视频"
            style={{
              width: '100%',
              flex: 1,
              minHeight: 0,
              background: '#15231e',
              borderRadius: 16,
              objectFit: 'contain',
            }}
            onLoadedMetadata={() => {
              const el = ref.current;
              if (!el) return;
              if (position > 0 && position < el.duration) el.currentTime = position;
              latest.current.onReady?.();
              if (autoPlay && !disabled) void el.play().catch(() => setBlocked(true));
            }}
            onPlay={() => {
              const el = ref.current;
              if (!el) return;
              if (disabled) {
                resume.current = !el.paused;
                el.pause();
              } else if (resume.current) {
                resume.current = false;
                void el.play().catch(() => setBlocked(true));
              } else setBlocked(false);
            }}
            onTimeUpdate={() => {
              if (ref.current) latest.current.onProgress?.(ref.current.currentTime);
            }}
            onEnded={() => {
              if (!disabled) latest.current.onEnded?.();
            }}
            onError={failed}
          />
          {blocked && (
            <button onClick={() => void ref.current?.play().catch(() => setBlocked(true))}>
              点击播放
            </button>
          )}
        </>
      ) : (
        <>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              position: 'relative',
              borderRadius: 20,
              background: '#fff',
              overflow: 'hidden',
            }}
          >
            <img
              key={`${url}:${retry}`}
              src={url}
              alt={props.imageDescribe}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
              }}
              onLoad={async (e) => {
                try {
                  await e.currentTarget.decode();
                  latest.current.onReady?.();
                } catch {
                  failed();
                }
              }}
              onError={failed}
            />
          </div>
          <div
            style={{
              fontSize: 'clamp(24px, 3vw, 44px)',
              fontWeight: 700,
              textAlign: 'center',
              lineHeight: 1.35,
              overflowWrap: 'anywhere',
              whiteSpace: 'pre-wrap',
            }}
          >
            {props.text}
          </div>
        </>
      )}
      <button
        aria-label="重新加载素材"
        style={{ alignSelf: 'center', fontSize: 14 }}
        onClick={() => setRetry((v) => v + 1)}
      >
        重新加载素材
      </button>
    </section>
  );
}

export type ComponentViewProps = Parameters<typeof MediaComponentView>[0];
/** Static executable views; LearnWeave supplies metadata, never remote JavaScript. */
const views: Record<string, typeof MediaComponentView> = {
  'picture-teaching@1.0.0': MediaComponentView,
  'video-player@1.0.0': MediaComponentView,
};
export function ComponentView(props: ComponentViewProps) {
  const View = views[`${props.content.componentRef.id}@${props.content.componentRef.version}`];
  return View ? <View {...props} /> : <div role="alert">当前安装版本不支持此组件展示</div>;
}
export function ComponentThumbnail({
  content,
  resolveAsset,
  visible = true,
}: Pick<ComponentViewProps, 'content' | 'resolveAsset'> & { visible?: boolean }) {
  if (!visible) return <div aria-label="组件缩略图" />;
  if (!views[`${content.componentRef.id}@${content.componentRef.version}`])
    return <div>未安装组件</div>;
  if (content.componentRef.id === 'video-player')
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          background: '#15231e',
          color: 'white',
        }}
        aria-label="视频缩略图"
      >
        ▶ 视频
      </div>
    );
  const props = content.props as unknown as PictureProps;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#fffaf0',
      }}
    >
      <img
        alt=""
        src={resolveAsset(props.imageUrl)}
        loading="lazy"
        style={{ width: '100%', minHeight: 0, flex: 1, objectFit: 'contain' }}
      />
      <span
        style={{
          textAlign: 'center',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {props.text}
      </span>
    </div>
  );
}
