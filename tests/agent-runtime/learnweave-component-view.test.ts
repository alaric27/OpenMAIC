import { createElement } from 'react';
import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComponentSceneThumbnail } from '@/extensions/learnweave/components/view';
it('thumbnails load no local renderer or video player', () => {
  const scene = {
    id: 's',
    stageId: 'stage',
    content: {
      type: 'component',
      componentRef: { id: 'any-future-component', version: '1' },
      props: {},
    },
  } as any;
  const html = renderToStaticMarkup(createElement(ComponentSceneThumbnail, { scene }));
  expect(html).not.toContain('<video');
  expect(html).not.toContain('<iframe');
  expect(html).toContain('组件缩略图');
});
