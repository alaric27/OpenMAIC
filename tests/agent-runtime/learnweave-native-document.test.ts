import { it, expect } from 'vitest';
import { productionDocument } from '../../extensions/learnweave/native-document';
it('exports generated native scene metadata without the workbench outline linkage', () => {
  const doc = {
    stage: { id: 'stage' },
    scenes: [
      {
        id: 'scene',
        outlineId: 'outline-1',
        createdAt: 123,
        actions: [],
        content: { type: 'slide', canvas: { elements: [] } },
        unknownContent: 'must still be validated',
      },
    ],
  };
  const native = productionDocument(doc);
  expect(native.scenes[0]).not.toHaveProperty('outlineId');
  expect(native.scenes[0]).toHaveProperty('createdAt', 123);
  expect(native.scenes[0]).toHaveProperty('unknownContent', 'must still be validated');
  expect(doc.scenes[0].outlineId).toBe('outline-1');
});
it('drops only the identical workbench audioUrl alias and rejects conflicting narration references', () => {
  const scene = {
    id: 's',
    actions: [
      {
        id: 'a',
        type: 'speech',
        text: 'Hello',
        audioId: 'owned-audio',
        audioUrl: 'owned-audio',
        voice: 'voice',
      },
    ],
  };
  const d = productionDocument({ stage: {}, scenes: [scene] });
  expect(d.scenes[0].actions?.[0]).toEqual({
    id: 'a',
    type: 'speech',
    text: 'Hello',
    audioId: 'owned-audio',
    voice: 'voice',
  });
  expect(scene.actions[0].audioUrl).toBe('owned-audio');
  expect(() =>
    productionDocument({
      stage: {},
      scenes: [{ ...scene, actions: [{ ...scene.actions[0], audioUrl: 'different-audio' }] }],
    }),
  ).toThrow('不一致');
});
