import { type ComponentContent } from './contracts.js';
declare function MediaComponentView({ content, resolveAsset, disabled, autoPlay, onReady, onEnded, onError, position, onProgress, }: {
    content: ComponentContent;
    resolveAsset: (ref: string) => string;
    disabled?: boolean;
    autoPlay?: boolean;
    onReady?: () => void;
    onEnded?: () => void;
    onError?: (message: string) => void;
    position?: number;
    onProgress?: (position: number) => void;
}): import("react/jsx-runtime").JSX.Element;
export type ComponentViewProps = Parameters<typeof MediaComponentView>[0];
export declare function ComponentView(props: ComponentViewProps): import("react/jsx-runtime").JSX.Element;
export declare function ComponentThumbnail({ content, resolveAsset, visible, }: Pick<ComponentViewProps, 'content' | 'resolveAsset'> & {
    visible?: boolean;
}): import("react/jsx-runtime").JSX.Element;
export {};
