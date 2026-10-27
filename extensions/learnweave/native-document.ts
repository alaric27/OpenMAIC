import { DSL_VERSION } from '@openmaic/dsl';
import type { NativeDesignDocument } from './transport-types';
/** Workbench linkage and scene edit timestamps are not playback content.
 * Normalize them before both manifest checks and export; preserve every content/playback field.
 */
export function productionDocument(doc: {
  stage: unknown;
  scenes: unknown[];
}): NativeDesignDocument {
  return {
    dslVersion: DSL_VERSION,
    stage: structuredClone(doc.stage),
    scenes: doc.scenes.map((scene) => {
      const {
        outlineId: _outlineId,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...native
      } = scene as Record<string, unknown>;
      const copy = structuredClone(native);
      if (Array.isArray(copy.actions))
        copy.actions = copy.actions.map((action: Record<string, unknown>) => {
          if (action.type !== 'speech' || !Object.hasOwn(action, 'audioUrl')) return action;
          if (typeof action.audioId !== 'string' || action.audioId !== action.audioUrl)
            throw Error('speech audioId 与工作台 audioUrl 不一致，请重新生成旁白');
          const { audioUrl: _audioUrl, ...dsl } = action;
          return dsl;
        });
      return copy;
    }),
  } as unknown as NativeDesignDocument;
}
