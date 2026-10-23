import { afterEach, describe, expect, it, vi } from 'vitest';
import { DSL_VERSION } from '@openmaic/dsl';
import { productionSpec, resolveAuthoring, prepareBundle } from '@/extensions/learnweave/client';
import type {
  ProductionSpec,
  NativeDesignDocument,
  ProductionBundle,
} from '@/extensions/learnweave/transport-types';

const hash = 'a'.repeat(64);
function spec(): ProductionSpec {
  return {
    producerApiVersion: 1,
    instanceId: 'local-openmaic',
    authoringSchema: { type: 'object', properties: { activities: { type: 'array' } } },
    authoringSchemaHash: hash,
    profile: {
      protocol: 'learnweave.capabilities',
      id: 'current-profile',
      dslVersion: DSL_VERSION,
      integrationBuild: 'unrelated-backend-build',
    },
    plans: [],
    planVersions: [],
    templateVersions: [],
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('LearnWeave HTTP production boundary', () => {
  it('uses the service schema without comparing a local shared-package fingerprint', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(spec()));
    vi.stubGlobal('fetch', fetcher);
    expect(await productionSpec()).toEqual(spec());
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', cache: 'no-store' });
  });
  it.each(['version', 'dsl', 'schema'])('rejects incompatible %s', async (kind) => {
    const value = spec() as any;
    if (kind === 'version') value.producerApiVersion = 2;
    if (kind === 'dsl') value.profile.dslVersion = 'unsupported';
    if (kind === 'schema') value.authoringSchema = null;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(value)));
    await expect(productionSpec()).rejects.toMatchObject({ status: 409 });
  });
  it('posts source data to the fixed service endpoint and verifies the response scope', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          producerApiVersion: 1,
          targetProfileId: 'current-profile',
          authoringSchemaHash: hash,
          documentHash: hash,
          manifest: { activities: [] },
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    const document = {
      stage: {},
      scenes: [],
      dslVersion: DSL_VERSION,
    } as unknown as NativeDesignDocument;
    await resolveAuthoring(spec(), document, { activities: [] });
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:3100/api/v1/course-production/resolve');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      producerApiVersion: 1,
      targetProfileId: 'current-profile',
      document,
    });
    fetcher.mockResolvedValueOnce(
      Response.json({
        producerApiVersion: 1,
        targetProfileId: 'another',
        authoringSchemaHash: hash,
        documentHash: hash,
        manifest: { activities: [] },
      }),
    );
    await expect(resolveAuthoring(spec(), document, {})).rejects.toMatchObject({ status: 503 });
  });
  it('keeps diagnostics and does not fall back on outage, empty proxy errors or redirects', async () => {
    const report = { valid: false, diagnostics: [{ code: 'REFERENCE_INVALID' }] };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ message: '引用无效', report }, { status: 422 }))
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockRejectedValueOnce(new Error('redirect'));
    vi.stubGlobal('fetch', fetcher);
    await expect(productionSpec()).rejects.toMatchObject({ status: 422, report });
    await expect(productionSpec()).rejects.toMatchObject({ status: 503 });
    await expect(productionSpec()).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('rejects a prepared bundle from another source revision', async () => {
    const bundle = {
      protocol: 'learnweave.production',
      protocolVersion: 1,
      targetProfileId: 'current-profile',
      source: {
        instanceId: 'local-openmaic',
        stageId: 'stage',
        nativeRevision: 3,
        learningRevision: 1,
        sourceDocumentHash: hash,
        bundleHash: hash,
      },
    } as ProductionBundle;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({
            producerApiVersion: 1,
            authoringSchemaHash: hash,
            bundle: { ...bundle, source: { ...bundle.source, nativeRevision: 4 } },
          }),
        ),
    );
    await expect(prepareBundle(spec(), bundle)).rejects.toMatchObject({ status: 503 });
  });
  it('rejects credentials and non-local cleartext origins before any request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    for (const origin of [
      'https://user:secret@example.com',
      'http://example.com',
      'https://example.com/path',
    ]) {
      vi.stubEnv('LEARNWEAVE_API_URL', origin);
      await expect(productionSpec()).rejects.toThrow('源站');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
