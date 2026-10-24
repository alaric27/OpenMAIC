'use client';
import { useMemo } from 'react';
import { sceneEditorRegistry } from '@/lib/edit/scene-editor-registry';
import type { SceneEditorSurface, SurfaceState } from '@/lib/edit/scene-editor-surface';
import type { SceneContent } from '@/lib/types/stage';
import { useStageStore } from '@/lib/store/stage';
import { ComponentSceneView } from './view';
function ComponentEditor() {
  const scenes = useStageStore.use.scenes();
  const id = useStageStore.use.currentSceneId();
  const scene = useMemo(() => scenes.find((s) => s.id === id), [scenes, id]);
  return scene ? <ComponentSceneView scene={scene} editing /> : null;
}
const state: SurfaceState<SceneContent, undefined> = {
  content: {} as SceneContent,
  selection: undefined,
  hasSelection: false,
  insertItems: [],
  floatingActions: [],
  commands: [],
  hints: [],
};
const surface: SceneEditorSurface<SceneContent, undefined> = {
  sceneType: 'component',
  supportsNarration: false,
  SurfaceComponent: ComponentEditor,
  useSurfaceState: () => state,
};
sceneEditorRegistry.register(surface);
