import { DSL_VERSION } from '@openmaic/dsl';
import {
  PRODUCER_API_VERSION,
  type ProductionSpec,
  type AuthoringManifest,
  type NativeDesignDocument,
  type ProductionBundle,
} from './transport-types';

export class ProductionError extends Error {
  constructor(
    message: string,
    readonly status = 422,
    readonly report?: unknown,
  ) {
    super(message);
  }
}
const hash = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function origin() {
  const url = new URL(process.env.LEARNWEAVE_API_URL || 'http://127.0.0.1:3100');
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
  )
    throw new ProductionError('LEARNWEAVE_API_URL 必须为 HTTPS 或本机 HTTP 源站', 503);
  return url.origin;
}

async function json(path: string, body?: unknown): Promise<any> {
  let response: Response;
  try {
    const base = origin();
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    if (encoded && Buffer.byteLength(encoded) > 20 * 1024 * 1024)
      throw new ProductionError('生产请求超过大小限制', 422);
    response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(encoded === undefined ? {} : { body: encoded }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    if (e instanceof ProductionError) throw e;
    throw new ProductionError('LearnWeave 生产服务不可用，请检查连接后重试', 503);
  }
  const limit = 20 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new ProductionError('生产服务响应超过大小限制', 503);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProductionError('生产服务返回空响应', 503);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new ProductionError('生产服务响应超过大小限制', 503);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  let data: any;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ProductionError('生产服务返回无效 JSON', 503);
  }
  if (!response.ok)
    throw new ProductionError(
      typeof data?.message === 'string' ? data.message.slice(0, 1000) : '生产请求失败',
      [400, 409, 422].includes(response.status) ? response.status : 503,
      record(data?.report) ? data.report : undefined,
    );
  return data;
}

export async function productionSpec(): Promise<ProductionSpec> {
  const spec = await json('/api/v1/course-production-spec');
  if (
    spec?.producerApiVersion !== PRODUCER_API_VERSION ||
    spec.profile?.protocol !== 'learnweave.capabilities' ||
    spec.profile.dslVersion !== DSL_VERSION ||
    typeof spec.profile.id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(spec.instanceId || '') ||
    !record(spec.authoringSchema) ||
    spec.authoringSchema.type !== 'object' ||
    !hash(spec.authoringSchemaHash) ||
    !Array.isArray(spec.plans) ||
    !Array.isArray(spec.planVersions) ||
    !Array.isArray(spec.templateVersions)
  )
    throw new ProductionError(
      '生产 HTTP 协议、Schema 或 DSL 版本不一致，请检查扩展与服务版本',
      409,
    );
  return spec;
}

export async function resolveAuthoring(
  spec: ProductionSpec,
  document: NativeDesignDocument,
  manifest: unknown,
) {
  const data = await json('/api/v1/course-production/resolve', {
    producerApiVersion: PRODUCER_API_VERSION,
    instanceId: spec.instanceId,
    targetProfileId: spec.profile.id,
    authoringSchemaHash: spec.authoringSchemaHash,
    document,
    manifest,
  });
  if (
    data?.producerApiVersion !== PRODUCER_API_VERSION ||
    data.targetProfileId !== spec.profile.id ||
    data.authoringSchemaHash !== spec.authoringSchemaHash ||
    !hash(data.documentHash) ||
    !record(data.manifest) ||
    !Array.isArray(data.manifest.activities)
  )
    throw new ProductionError('生产清单响应与请求规范不一致', 503);
  return data as { documentHash: string; manifest: AuthoringManifest; targetProfileId: string };
}

export async function prepareBundle(
  spec: ProductionSpec,
  bundle: ProductionBundle,
): Promise<ProductionBundle> {
  const data = await json('/api/v1/course-production/prepare', {
    producerApiVersion: PRODUCER_API_VERSION,
    authoringSchemaHash: spec.authoringSchemaHash,
    bundle,
  });
  const prepared = data?.bundle;
  if (
    data?.producerApiVersion !== PRODUCER_API_VERSION ||
    data.authoringSchemaHash !== spec.authoringSchemaHash ||
    prepared?.protocol !== 'learnweave.production' ||
    prepared.protocolVersion !== 1 ||
    prepared.targetProfileId !== spec.profile.id ||
    prepared.source?.instanceId !== spec.instanceId ||
    prepared.source.stageId !== bundle.source.stageId ||
    prepared.source.nativeRevision !== bundle.source.nativeRevision ||
    prepared.source.learningRevision !== bundle.source.learningRevision ||
    !record(prepared.course) ||
    !record(prepared.course.document) ||
    prepared.course.document.stage?.id !== bundle.source.stageId ||
    !Array.isArray(prepared.course.activities) ||
    !Array.isArray(prepared.assets) ||
    !hash(prepared.source.sourceDocumentHash) ||
    !hash(prepared.source.bundleHash)
  )
    throw new ProductionError('生产 Bundle 响应与源修订不一致', 503);
  return prepared;
}
