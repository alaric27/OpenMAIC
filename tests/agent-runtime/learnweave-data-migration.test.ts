import { describe, expect, it } from 'vitest';
// One-time operator script is intentionally outside the application module graph.
import { convertManifest } from '../../scripts/migrate-learnweave-templates.mjs';
const spec = { teachingProfiles: [{ id: 'picture', method: 'picture-talk' }] };
const convert = (activities: unknown[], scenes: unknown[] = []) => convertManifest(
  { manifest: { activities } }, { name: 'Old course' }, scenes, spec,
);
describe('retired template data conversion', () => {
  it('keeps IDs, ordering and custom teaching instructions without inventing task parameters', () => {
    const result = convert([
      { id: 'one', title: 'One', contentRef: 'slide', templateId: 'custom',
        instructions: 'Wait for the child', hints: ['Look again'],
        standard: { content: { teaching: { method: 'teaching.picture-talk', prompt: 'Custom prompt' } } } },
      { id: 'two', title: 'Two', contentRef: 'slide', templateId: 'teaching.sentence-expression' },
    ]);
    expect(result.activities.map((a: { id: string }) => a.id)).toEqual(['one', 'two']);
    expect(result.activities[0]).toMatchObject({ teachingProfileId: 'picture',
      data: { method: 'picture-talk', sceneId: 'slide' }, notes: expect.stringContaining('Custom prompt') });
    expect(result.activities[0].notes).toContain('Look again');
    expect(result.activities[1].data).not.toHaveProperty('task');
    expect(result.level).toBe('待配置');
  });
  it('keeps quiz answers in the native page and migrates image/audio bindings', () => {
    const scene = { id: 'slide', content: { canvas: { elements: [
      { id: 'audio', src: '/api/persistence/assets/saved-audio/content' },
    ] } } };
    const result = convert([{ id: 'listen', title: 'Listen', contentRef: 'slide',
      templateId: 'practice.listen-image', quizSceneId: 'quiz', questionId: 'q',
      maxAttempts: 2, mediaElementId: 'audio', optionImageElementIds: { A: 'apple' } }], [scene]);
    expect(result.activities[0]).toMatchObject({ kind: 'quiz', sceneIds: ['slide', 'quiz'],
      data: { questionIds: ['q'], maxAttempts: 2, promptAudioAssetId: 'saved-audio',
        optionImages: { q: { A: 'apple' } } } });
  });
  it('keeps media asset references and does not modify the source records', () => {
    const old = { id: 'media', title: 'Song', templateId: 'media.audio', contentRef: 's', mediaElementId: 'a' };
    const before = structuredClone(old);
    expect(convert([old], [{ id: 's', content: { canvas: { elements: [{ id: 'a', src: 'saved' }] } } }])
      .activities[0].data).toEqual({ kind: 'audio', assetId: 'saved', presentationSceneId: 's' });
    expect(old).toEqual(before);
  });
});
