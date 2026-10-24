import { createElement } from 'react';
import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComponentThumbnail, ComponentView } from '@openmaic/scene-components/react';
const content={type:'component' as const,componentRef:{id:'video-player',version:'1.0.0'},props:{videoUrl:'ast_video',videoDescribe:'A short video'}};
it('video thumbnails mount no video player or media src',()=>{
 const html=renderToStaticMarkup(createElement(ComponentThumbnail,{content,resolveAsset:(r:string)=>'/media/'+r}));
 expect(html).not.toContain('<video');expect(html).not.toContain('ast_video');expect(html).toContain('视频缩略图');
 expect(renderToStaticMarkup(createElement(ComponentThumbnail,{content,resolveAsset:(r:string)=>r,visible:false}))).not.toContain('▶');
});
it('unsupported installed views fail explicitly without interpreting props',()=>{
 const html=renderToStaticMarkup(createElement(ComponentView,{content:{...content,componentRef:{id:'new-exercise',version:'1'}},resolveAsset:()=>{throw Error('must not resolve unknown views')}}));
 expect(html).toContain('不支持此组件展示');
});
