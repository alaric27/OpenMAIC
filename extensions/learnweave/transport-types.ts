import type {
  Action,
  Scene,
  Stage,
  SlideContent,
  QuizContent,
  InteractiveContent,
  PBLContent,
  ComponentContent,
} from '@openmaic/dsl';

// Only transport envelopes live here. Activity schemas and semantic rules come from the service.
export const PRODUCER_API_VERSION = 1;
export type NativeDesignDocument = {
  dslVersion: string;
  stage: Stage;
  scenes: Scene<
    Action,
    SlideContent | QuizContent | InteractiveContent | PBLContent | ComponentContent
  >[];
};
export type AuthoringManifest = Record<string, unknown> & {
  activities: { id: string; kind: string; data: Record<string, unknown> }[];
};
export interface ProductionSpec {
  producerApiVersion: 1;
  instanceId: string;
  authoringSchema: Record<string, unknown>;
  authoringSchemaHash: string;
  profile: { id: string; dslVersion: string; [key: string]: unknown };
  plans: {
    revision: number;
    value: { id: string; schemaVersion?: number; nodes: { templateId?: string; templateRevision?: number; segments?: {templateId:string;templateRevision:number}[] }[] };
    activities?: {nodeId:string;segmentId?:string;configuration:{id:string;templateId:string;templateRevision:number;[key:string]:unknown};[key:string]:unknown}[];
  }[];
  planVersions: ProductionSpec['plans'];
  templateVersions: { revision: number; value: { id: string } }[];
  [key: string]: unknown;
}
export interface SourceAsset {
  id: string;
  sourceRef: string;
  revision: string;
  kind: 'image' | 'audio' | 'video';
  mimeType: string;
  byteSize: number;
  sha256: string;
  dependencies: string[];
  inlineBase64?: string;
}
export interface ProductionBundle {
  protocol: 'learnweave.production';
  protocolVersion: 1;
  targetProfileId: string;
  source: {
    instanceId: string;
    stageId: string;
    nativeRevision: number;
    learningRevision: number;
    sceneRevisions: Record<string, number>;
    upstreamCommit: string;
    sourceDocumentHash: string;
    bundleHash: string;
  };
  course: Record<string, unknown> & { document: NativeDesignDocument };
  assets: SourceAsset[];
}
