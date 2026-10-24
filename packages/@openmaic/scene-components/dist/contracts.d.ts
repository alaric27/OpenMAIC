/** Versioned, single-page content contracts. No runtime state or completion policy. */
export interface PictureProps {
    text: string;
    imageUrl: string;
    imageDescribe: string;
}
export interface VideoProps {
    videoUrl: string;
    videoDescribe: string;
}
export declare const COMPONENTS: {
    readonly 'picture-teaching': {
        readonly version: "1.0.0";
        readonly templateId: "teaching-picture";
        readonly assetField: "imageUrl";
        readonly assetKind: "image";
        readonly fields: {
            readonly text: "页面上需要展示和教学的文字";
            readonly imageUrl: "图片素材地址";
            readonly imageDescribe: "图片描述，供 AI 老师理解画面";
        };
    };
    readonly 'video-player': {
        readonly version: "1.0.0";
        readonly templateId: "media-video";
        readonly assetField: "videoUrl";
        readonly assetKind: "video";
        readonly fields: {
            readonly videoUrl: "视频素材地址";
            readonly videoDescribe: "视频内容描述";
        };
    };
};
export type ComponentId = keyof typeof COMPONENTS;
export interface ComponentContent {
    type: 'component';
    componentRef: {
        id: string;
        version: string;
    };
    props: Record<string, unknown>;
    assetSlots?: AssetSlot[];
}
export declare function componentContract(ref: {
    id: string;
    version: string;
}): {
    readonly version: "1.0.0";
    readonly templateId: "teaching-picture";
    readonly assetField: "imageUrl";
    readonly assetKind: "image";
    readonly fields: {
        readonly text: "页面上需要展示和教学的文字";
        readonly imageUrl: "图片素材地址";
        readonly imageDescribe: "图片描述，供 AI 老师理解画面";
    };
} | {
    readonly version: "1.0.0";
    readonly templateId: "media-video";
    readonly assetField: "videoUrl";
    readonly assetKind: "video";
    readonly fields: {
        readonly videoUrl: "视频素材地址";
        readonly videoDescribe: "视频内容描述";
    };
} | undefined;
export declare function contentSchema(ref: {
    id: string;
    version: string;
}): {
    $schema: string;
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
        [k: string]: {
            type: string;
            description: "页面上需要展示和教学的文字" | "图片素材地址" | "图片描述，供 AI 老师理解画面" | "视频素材地址" | "视频内容描述";
        };
    };
};
/** Same structural rules as contentSchema. Material ownership/MIME are host checks. */
export declare function componentIssue(content: ComponentContent): string | undefined;
export interface AssetSlot {
    path: string;
    kind: 'image' | 'video' | 'audio';
}
export interface ComponentDefinition {
    componentRef: {
        id: string;
        version: string;
    };
    contentSchema: Record<string, unknown>;
    assetSlots: AssetSlot[];
}
export declare function assetSlots(ref: {
    id: string;
    version: string;
}): AssetSlot[];
export declare function propsIssue(schema: Record<string, unknown>, props: unknown): string | undefined;
/** Resolve declared JSON-pointer fields, with * for array/object members. Never scan description text. */
export declare function componentAssets(props: unknown, slots: readonly AssetSlot[]): {
    path: string;
    kind: AssetSlot["kind"];
    ref: string;
}[];
