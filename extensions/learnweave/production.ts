import { componentAssets, propsIssue } from '@openmaic/scene-components';
import { definitionFor } from './components/definitions';
import { ownedCourseAudio } from './course-media-snapshot';
import { bundledAvatar } from './bundled-avatar';
import { productionDocument } from './native-document';
import { createHash } from 'node:crypto';
import type {
  NativeDesignDocument,
  SourceAsset,
  ProductionBundle,
  AuthoringManifest,
} from './transport-types';
import { applySchemaMigrations } from '@openmaic/storage/pg-migrations';
import {
  getServerPersistenceProvider,
  getOwnerScopedDocumentStore,
  assertOwnedWrite,
  assetPrincipalForOwner,
  type Queryable,
} from './adapter';
import { productionSpec, resolveAuthoring, prepareBundle, ProductionError } from './client';
import { LEARNWEAVE_COURSE_MIGRATIONS } from './migrations';
export { productionSpec, ProductionError } from './client';
async function provider() {
  const p = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  await applySchemaMigrations(p.pool, LEARNWEAVE_COURSE_MIGRATIONS);
  return p;
}
export async function readCourse(stageId: string) {
  const p = await provider();
  const r = await p.pool.query(
    'SELECT revision,manifest,document_hash,target_profile_id FROM learnweave_course_definitions WHERE stage_id=$1',
    [stageId],
  );
  return r.rows[0] || null;
}
async function nativeDocument(ownerId: string, stageId: string) {
  const store = await getOwnerScopedDocumentStore(ownerId);
  const doc = await store.loadDocument(stageId);
  if (!doc) throw new ProductionError('课程不存在', 404);
  return productionDocument(doc);
}
export async function saveCourse(
  ownerId: string,
  stageId: string,
  expectedRevision: number,
  manifest: unknown,
  fence?: (tx: Queryable) => Promise<void>,
  assertActive: () => void = () => {},
) {
  const spec = await productionSpec();
  const store = await getOwnerScopedDocumentStore(ownerId);
  const before = await store.readFreshnessManifest(stageId);
  if (!before) throw new ProductionError('课程不存在', 404);
  const doc = await nativeDocument(ownerId, stageId);
  // HTTP work stays outside the write transaction. Recheck the source under its owner lock.
  const resolved = await resolveAuthoring(spec, doc, manifest);
  const documentHash = resolved.documentHash;
  manifest = resolved.manifest;
  const p = await provider();
  return p.withTransaction(async (tx) => {
    assertActive();
    await assertOwnedWrite(tx, ownerId, stageId, fence);
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`learnweave-course:${stageId}`]);
    const current = await tx.query(
      'SELECT revision FROM learnweave_course_definitions WHERE stage_id=$1 FOR UPDATE',
      [stageId],
    );
    if ((current.rows[0]?.revision ?? 0) !== expectedRevision)
      throw new ProductionError('活动清单已改变，请重新读取 revision', 409);
    // Native content is protected by the stage owner lock used by document writers.
    const latest = await store.readFreshnessManifest(stageId);
    if (!latest || latest.rev !== before.rev)
      throw new ProductionError('课程正在保存，请稍后重试', 409);
    const revision = expectedRevision + 1;
    await tx.query(
      `INSERT INTO learnweave_course_definitions(stage_id,revision,manifest,document_hash,target_profile_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(stage_id) DO UPDATE SET revision=$2,manifest=$3,document_hash=$4,target_profile_id=$5,updated_at=now()`,
      [stageId, revision, manifest, documentHash, spec.profile.id],
    );
    assertActive();
    return { revision, manifest, targetProfileId: spec.profile.id };
  });
}
export async function produceBundle(ownerId: string, stageId: string) {
  const spec = await productionSpec();
  const store = await getOwnerScopedDocumentStore(ownerId);
  const before = await store.readFreshnessManifest(stageId);
  const row = await readCourse(stageId);
  if (!row) throw new ProductionError('请先保存课程活动清单');
  if (!row.document_hash)
    throw new ProductionError('迁移草稿需要检查配置并重新保存后才能导出', 409);
  const document = await nativeDocument(ownerId, stageId);
  if (row.target_profile_id !== spec.profile.id)
    throw new ProductionError('原生内容或目标能力已改变，请重新保存活动清单', 409);
  const p = await provider();
  const assets: SourceAsset[] = [];
  const bindings: { documentPointer: string; assetId: string }[] = [];
  const bySource = new Map<string, SourceAsset>();
  const resourceKeys = new Set(['src', 'poster', 'mediaRef', 'audioId', 'avatar']);
  async function assetFor(child: unknown): Promise<SourceAsset> {
    if (typeof child !== 'string' || !child)
      throw new ProductionError('素材引用必须为已保存素材 ID');
    let asset = bySource.get(child);
    if (!asset) {
      const bundled = (await bundledAvatar(child)) || (await ownedCourseAudio(child, stageId));
      if (bundled) {
        asset = {
          id: `asset-${createHash('sha256').update(child).digest('hex').slice(0, 24)}`,
          sourceRef: child,
          revision: bundled.sha256,
          kind: bundled.mimeType.startsWith('audio/') ? 'audio' : 'image',
          mimeType: bundled.mimeType,
          byteSize: bundled.bytes.length,
          sha256: bundled.sha256,
          dependencies: [],
          inlineBase64: bundled.bytes.toString('base64'),
        };
        bySource.set(child, asset);
        assets.push(asset);
        return asset;
      }
      const match = /^\/api\/persistence\/assets\/([A-Za-z0-9_-]+)\/content$/.exec(child);
      const id = match?.[1] || child;
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(id))
        throw new ProductionError('素材必须先保存至当前作者素材库');
      const bytes = await p.assetStore.resolve(assetPrincipalForOwner(ownerId), id);
      if (!bytes) throw new ProductionError('素材缺失或无权读取');
      const kind = bytes.mime.split('/')[0];
      if (!['image', 'audio', 'video'].includes(kind!))
        throw new ProductionError('当前导出尚未验证此类素材');
      asset = {
        id: `asset-${createHash('sha256').update(child).digest('hex').slice(0, 24)}`,
        sourceRef: id,
        revision: String(bytes.revision),
        kind: kind as SourceAsset['kind'],
        mimeType: bytes.mime,
        byteSize: bytes.bytes.length,
        sha256: createHash('sha256').update(bytes.bytes).digest('hex'),
        dependencies: [],
      };
      bySource.set(child, asset);
      assets.push(asset);
    }

    asset.sourceRef = child;

    return asset;
  }
  async function scan(value: unknown, path: string): Promise<void> {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) await scan(value[i], `${path}/${i}`);
      return;
    }
    const c = value as Record<string, any>;
    if (c.type === 'component' && c.componentRef) {
      const definition = definitionFor(spec, c.componentRef);
      const issue = propsIssue(definition.contentSchema, c.props);
      if (issue) throw new ProductionError(issue);
      for (const slot of componentAssets(c.props, definition.assetSlots)) {
        const asset = await assetFor(slot.ref);
        if (asset.kind !== slot.kind) throw new ProductionError('组件素材类型不匹配');
        bindings.push({ documentPointer: `${path}/props${slot.path}`, assetId: asset.id });
      }
    }
    for (const [key, child] of Object.entries(value)) {
      const pointer = `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      if (typeof child === 'string' && child && resourceKeys.has(key)) {
        const asset = await assetFor(child);
        bindings.push({ documentPointer: pointer, assetId: asset.id });
      }
      await scan(child, pointer);
    }
  }
  await scan(document, '');
  const {
    templateSelections: _templateSelections,
    planSelection: _planSelection,
    ...authored
  } = structuredClone(row.manifest) as AuthoringManifest;
  for (const activity of authored.activities) {
    if (activity.kind === 'media')
      activity.data.assetId = (await assetFor(activity.data.assetId)).id;
    if (activity.kind === 'quiz') {
      if (activity.data.promptAudioAssetId)
        activity.data.promptAudioAssetId = (await assetFor(activity.data.promptAudioAssetId)).id;
      for (const options of Object.values(activity.data.optionImages || {}) as Record<
        string,
        string
      >[]) {
        for (const key of Object.keys(options)) options[key] = (await assetFor(options[key]!)).id;
      }
    }
  }
  const definition = {
    ...authored,
    document,
    assets: assets.map(({ sourceRef: _s, revision: _r, inlineBase64: _inline, ...a }) => ({
      ...a,
      storageKey: a.id,
    })),
    assetBindings: bindings,
    requiredCapabilities: [],
  };
  const after = await store.readFreshnessManifest(stageId);
  const current = await readCourse(stageId);
  if (!before || !after || before.rev !== after.rev || current?.revision !== row.revision)
    throw new ProductionError('读取期间课程已改变，请重试', 409);
  for (const source of assets) {
    if (source.inlineBase64) continue;
    const match = /^\/api\/persistence\/assets\/([A-Za-z0-9_-]+)\/content$/.exec(source.sourceRef);
    const meta = await p.assetStore.identify(
      assetPrincipalForOwner(ownerId),
      match?.[1] || source.sourceRef,
    );
    if (!meta || String(meta.revision) !== source.revision)
      throw new ProductionError('读取期间素材已改变，请重试', 409);
  }
  const { assets: _assets, ...course } = definition;
  const bundle: ProductionBundle = {
    protocol: 'learnweave.production',
    protocolVersion: 1,
    targetProfileId: spec.profile.id,
    source: {
      instanceId: spec.instanceId,
      stageId,
      nativeRevision: after.rev,
      learningRevision: row.revision,
      sceneRevisions: Object.fromEntries(after.scenes.map((s) => [s.id, s.rev])),
      upstreamCommit: '58dbe500997c4774ff494a00ac4bdcd0e0c4124d',
      sourceDocumentHash: '0'.repeat(64),
      bundleHash: '0'.repeat(64),
    },
    course,
    assets,
  };
  const prepared = await prepareBundle(spec, bundle);
  if (prepared.source.sourceDocumentHash !== row.document_hash)
    throw new ProductionError('原生内容已改变，请重新保存活动清单', 409);
  // Preparation may take time: reject a document/manifest/asset changed during the HTTP call.
  const final = await store.readFreshnessManifest(stageId);
  if (!final || final.rev !== after.rev || (await readCourse(stageId))?.revision !== row.revision)
    throw new ProductionError('准备期间课程已改变，请重试', 409);
  for (const source of assets) {
    if (source.inlineBase64) {
      const current =
        (await bundledAvatar(source.sourceRef)) ||
        (await ownedCourseAudio(source.sourceRef, stageId));
      if (!current || current.sha256 !== source.sha256)
        throw new ProductionError('准备期间内联素材已改变，请重试', 409);
      continue;
    }
    const match = /^\/api\/persistence\/assets\/([A-Za-z0-9_-]+)\/content$/.exec(source.sourceRef);
    const meta = await p.assetStore.identify(
      assetPrincipalForOwner(ownerId),
      match?.[1] || source.sourceRef,
    );
    if (!meta || String(meta.revision) !== source.revision)
      throw new ProductionError('准备期间素材已改变，请重试', 409);
  }
  return prepared;
}
