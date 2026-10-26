export function contentSchema(ref: { id: string; version: string }) {
  const fields =
    ref.id === 'picture-teaching'
      ? {
          text: '页面上需要展示和教学的文字',
          imageUrl: '图片素材地址',
          imageDescribe: '图片描述，供 AI 老师理解画面',
        }
      : { videoUrl: '视频素材地址', videoDescribe: '视频内容描述' };
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(fields),
    properties: Object.fromEntries(
      Object.entries(fields).map(([key, description]) => [key, { type: 'string', description }]),
    ),
  };
}
export function assetSlots(ref: { id: string; version: string }) {
  return [
    {
      path: ref.id === 'picture-teaching' ? '/imageUrl' : '/videoUrl',
      kind: ref.id === 'picture-teaching' ? 'image' : 'video',
    },
  ];
}
