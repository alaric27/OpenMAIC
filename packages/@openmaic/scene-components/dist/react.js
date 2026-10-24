'use client';
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { componentIssue, } from './contracts.js';
const frame = {
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
function MediaComponentView({ content, resolveAsset, disabled = false, autoPlay = false, onReady, onEnded, onError, position = 0, onProgress, }) {
    const ref = useRef(null);
    const resume = useRef(false);
    const [blocked, setBlocked] = useState(false);
    const [retry, setRetry] = useState(0);
    const latest = useRef({ onReady, onEnded, onError, onProgress });
    latest.current = { onReady, onEnded, onError, onProgress };
    const issue = componentIssue(content);
    const video = content.componentRef.id === 'video-player';
    const props = content.props;
    const url = issue ? '' : resolveAsset(video ? props.videoUrl : props.imageUrl);
    useEffect(() => {
        const el = ref.current;
        if (!el)
            return;
        if (disabled) {
            resume.current = !el.paused;
            el.pause();
        }
        else if (resume.current) {
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
    if (issue)
        return _jsx("div", { role: "alert", children: issue });
    const failed = () => latest.current.onError?.('素材加载失败，请重试');
    return (_jsxs("section", { style: frame, "aria-label": video ? '视频播放' : '看图教学', children: [video ? (_jsxs(_Fragment, { children: [_jsx("video", { ref: ref, src: url, controls: true, playsInline: true, "aria-label": "\u6559\u5B66\u89C6\u9891", style: {
                            width: '100%',
                            flex: 1,
                            minHeight: 0,
                            background: '#15231e',
                            borderRadius: 16,
                            objectFit: 'contain',
                        }, onLoadedMetadata: () => {
                            const el = ref.current;
                            if (!el)
                                return;
                            if (position > 0 && position < el.duration)
                                el.currentTime = position;
                            latest.current.onReady?.();
                            if (autoPlay && !disabled)
                                void el.play().catch(() => setBlocked(true));
                        }, onPlay: () => {
                            const el = ref.current;
                            if (!el)
                                return;
                            if (disabled) {
                                resume.current = !el.paused;
                                el.pause();
                            }
                            else if (resume.current) {
                                resume.current = false;
                                void el.play().catch(() => setBlocked(true));
                            }
                            else
                                setBlocked(false);
                        }, onTimeUpdate: () => {
                            if (ref.current)
                                latest.current.onProgress?.(ref.current.currentTime);
                        }, onEnded: () => {
                            if (!disabled)
                                latest.current.onEnded?.();
                        }, onError: failed }, `${url}:${retry}`), blocked && (_jsx("button", { onClick: () => void ref.current?.play().catch(() => setBlocked(true)), children: "\u70B9\u51FB\u64AD\u653E" }))] })) : (_jsxs(_Fragment, { children: [_jsx("div", { style: {
                            flex: 1,
                            minHeight: 0,
                            position: 'relative',
                            borderRadius: 20,
                            background: '#fff',
                            overflow: 'hidden',
                        }, children: _jsx("img", { src: url, alt: props.imageDescribe, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }, onLoad: async (e) => {
                                try {
                                    await e.currentTarget.decode();
                                    latest.current.onReady?.();
                                }
                                catch {
                                    failed();
                                }
                            }, onError: failed }, `${url}:${retry}`) }), _jsx("div", { style: {
                            fontSize: 'clamp(24px, 3vw, 44px)',
                            fontWeight: 700,
                            textAlign: 'center',
                            lineHeight: 1.35,
                            overflowWrap: 'anywhere',
                            whiteSpace: 'pre-wrap',
                        }, children: props.text })] })), _jsx("button", { "aria-label": "\u91CD\u65B0\u52A0\u8F7D\u7D20\u6750", style: { alignSelf: 'center', fontSize: 14 }, onClick: () => setRetry((v) => v + 1), children: "\u91CD\u65B0\u52A0\u8F7D\u7D20\u6750" })] }));
}
/** Static executable views; LearnWeave supplies metadata, never remote JavaScript. */
const views = {
    'picture-teaching@1.0.0': MediaComponentView,
    'video-player@1.0.0': MediaComponentView,
};
export function ComponentView(props) {
    const View = views[`${props.content.componentRef.id}@${props.content.componentRef.version}`];
    return View ? _jsx(View, { ...props }) : _jsx("div", { role: "alert", children: "\u5F53\u524D\u5B89\u88C5\u7248\u672C\u4E0D\u652F\u6301\u6B64\u7EC4\u4EF6\u5C55\u793A" });
}
export function ComponentThumbnail({ content, resolveAsset, visible = true, }) {
    if (!visible)
        return _jsx("div", { "aria-label": "\u7EC4\u4EF6\u7F29\u7565\u56FE" });
    if (!views[`${content.componentRef.id}@${content.componentRef.version}`])
        return _jsx("div", { children: "\u672A\u5B89\u88C5\u7EC4\u4EF6" });
    if (content.componentRef.id === 'video-player')
        return (_jsx("div", { style: {
                width: '100%',
                height: '100%',
                display: 'grid',
                placeItems: 'center',
                background: '#15231e',
                color: 'white',
            }, "aria-label": "\u89C6\u9891\u7F29\u7565\u56FE", children: "\u25B6 \u89C6\u9891" }));
    const props = content.props;
    return (_jsxs("div", { style: {
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: '#fffaf0',
        }, children: [_jsx("img", { alt: "", src: resolveAsset(props.imageUrl), loading: "lazy", style: { width: '100%', minHeight: 0, flex: 1, objectFit: 'contain' } }), _jsx("span", { style: {
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }, children: props.text })] }));
}
