import Ajv from 'ajv';
export const COMPONENTS = {
    'picture-teaching': {
        version: '1.0.0',
        templateId: 'teaching-picture',
        assetField: 'imageUrl',
        assetKind: 'image',
        fields: {
            text: '页面上需要展示和教学的文字',
            imageUrl: '图片素材地址',
            imageDescribe: '图片描述，供 AI 老师理解画面',
        },
    },
    'video-player': {
        version: '1.0.0',
        templateId: 'media-video',
        assetField: 'videoUrl',
        assetKind: 'video',
        fields: { videoUrl: '视频素材地址', videoDescribe: '视频内容描述' },
    },
};
export function componentContract(ref) {
    const c = COMPONENTS[ref.id];
    return c && c.version === ref.version ? c : undefined;
}
export function contentSchema(ref) {
    const c = componentContract(ref);
    if (!c)
        throw new Error('不支持的组件或版本');
    return {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        additionalProperties: false,
        required: Object.keys(c.fields),
        properties: Object.fromEntries(Object.entries(c.fields).map(([key, description]) => [key, { type: 'string', description }])),
    };
}
/** Same structural rules as contentSchema. Material ownership/MIME are host checks. */
export function componentIssue(content) {
    const c = componentContract(content.componentRef);
    if (!c)
        return '不支持的组件或版本';
    if (!content.props || typeof content.props !== 'object' || Array.isArray(content.props))
        return '组件内容必须为对象';
    const fields = Object.keys(c.fields);
    if (fields.some((k) => typeof content.props[k] !== 'string') ||
        Object.keys(content.props).some((k) => !fields.includes(k)))
        return '组件字段缺失、类型错误或包含未知字段';
}
export function assetSlots(ref) {
    const c = componentContract(ref);
    if (!c)
        throw Error('不支持的组件或版本');
    return [{ path: '/' + c.assetField, kind: c.assetKind }];
}
const ajv = new Ajv({ strict: false, allErrors: true });
const validators = new Map();
export function propsIssue(schema, props) {
    try {
        const key = JSON.stringify(schema);
        let validate = validators.get(key);
        if (!validate) {
            validate = ajv.compile(schema);
            if (validators.size >= 128)
                validators.clear();
            validators.set(key, validate);
        }
        return validate(props) ? undefined : ajv.errorsText(validate.errors, { separator: '; ' });
    }
    catch {
        return '内容 Schema 无效或包含不支持的引用';
    }
}
/** Resolve declared JSON-pointer fields, with * for array/object members. Never scan description text. */
export function componentAssets(props, slots) {
    const out = [];
    const escape = (s) => s.replace(/~/g, '~0').replace(/\//g, '~1');
    for (const slot of slots) {
        if (!slot || !['image', 'video', 'audio'].includes(slot.kind) || !/^\//.test(slot.path))
            throw Error('组件素材字段描述无效');
        const visit = (value, parts, path) => {
            if (!parts.length) {
                if (value === undefined || value === null)
                    return;
                if (typeof value !== 'string')
                    throw Error('素材引用必须为 string');
                if (value)
                    out.push({ path, kind: slot.kind, ref: value });
                return;
            }
            if (!value || typeof value !== 'object')
                return;
            const [part, ...rest] = parts;
            if (part === '*')
                for (const [key, child] of Object.entries(value))
                    visit(child, rest, path + '/' + escape(key));
            else {
                const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
                if (Object.hasOwn(value, key))
                    visit(value[key], rest, path + '/' + escape(key));
            }
        };
        visit(props, slot.path.slice(1).split('/'), '');
    }
    return out;
}
