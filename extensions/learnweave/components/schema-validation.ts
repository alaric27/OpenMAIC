import Ajv from 'ajv';
const ajv = new Ajv({ strict: false, allErrors: true });
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
export function propsIssue(schema: Record<string, unknown>, props: unknown): string | undefined {
  try {
    const key = JSON.stringify(schema);
    let validate = validators.get(key);
    if (!validate) {
      validate = ajv.compile(schema);
      if (validators.size >= 128) validators.clear();
      validators.set(key, validate);
    }
    return validate(props) ? undefined : ajv.errorsText(validate.errors, { separator: '; ' });
  } catch {
    return '内容 Schema 无效或包含不支持的引用';
  }
}
