/** One-time data conversion. Never imported by application startup. Run with --apply. */
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

export function convertManifest(row, stage, scenes, spec) {
  const asset = (sceneId, elementId) => {
    const scene = scenes.find((s) => s.id === sceneId);
    const element = scene?.content?.canvas?.elements?.find((e) => e.id === elementId);
    const src = element?.src;
    return typeof src === 'string'
      ? (/^\/api\/persistence\/assets\/([^/]+)\/content$/.exec(src)?.[1] || src)
      : '';
  };
  return {
    title: stage.name || '迁移课程', language: 'en', level: '待配置',
    objectives: [],
    activities: row.manifest.activities.map((old) => {
      const method = old.standard?.content?.teaching?.method || old.templateId;
      let kind, data, teachingProfileId;
      if (old.quizSceneId) {
        kind = 'quiz';
        data = { quizSceneId: old.quizSceneId, questionIds: [old.questionId],
          maxAttempts: old.maxAttempts, presentationSceneId: old.contentRef };
        if (old.optionImageElementIds)
          data.optionImages = { [old.questionId]: old.optionImageElementIds };
        if (old.templateId === 'practice.listen-image')
          data.promptAudioAssetId = asset(old.contentRef, old.mediaElementId);
      } else if (old.templateId === 'media.audio') {
        kind = 'media';
        data = { kind: 'audio', assetId: asset(old.contentRef, old.mediaElementId),
          presentationSceneId: old.contentRef };
      } else {
        kind = 'teaching';
        const name = method.replace(/^teaching\./, '');
        data = { method: name, sceneId: old.contentRef };
        if (old.data) data.task = structuredClone(old.data.task || old.data);
        teachingProfileId = spec.teachingProfiles.find((p) => p.method === name)?.id || '';
      }
      const notes = [old.instructions, old.goal, old.notes,
        old.hints?.length ? `原提示：${old.hints.join('；')}` : '',
        old.standard?.content?.teaching?.prompt,
      ].filter(Boolean).join('\n');
      return { id: old.id, title: old.title, kind, data,
        objectiveIds: [], sceneIds: [...new Set([old.contentRef, old.quizSceneId].filter(Boolean))],
        endPolicy: { allowSkip: true, maxActiveMs: 300000 },
        ...(teachingProfileId !== undefined ? { teachingProfileId } : {}),
        ...(notes ? { notes } : {}),
      };
    }),
  };
}

async function main() {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  const apply = process.argv.includes('--apply');
  const origin = new URL(process.env.LEARNWEAVE_API_URL || 'http://127.0.0.1:3100');
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(origin.hostname)))
    throw Error('生产服务必须使用 HTTPS 或本机 HTTP');
  const response = await fetch(new URL('/api/v1/course-production-spec', origin), {
    redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`生产规范服务不可用：${response.status}`);
  const spec = await response.json();
  if (spec.producerApiVersion !== 1) throw Error('不支持的生产 API 版本');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('learnweave-template-retirement'))");
    const exists = (await db.query("SELECT to_regclass('learnweave_templates') AS name")).rows[0].name;
    if (!exists) { console.log('旧模板表不存在，无需迁移'); await db.query('ROLLBACK'); return; }
    // Lock source and native data to keep the backup and converted drafts consistent.
    await db.query('LOCK TABLE learnweave_templates IN ACCESS EXCLUSIVE MODE');
    await db.query('LOCK TABLE document_stages, document_scenes IN SHARE MODE');
    await db.query(`CREATE TABLE IF NOT EXISTS learnweave_course_definitions (
      stage_id TEXT PRIMARY KEY REFERENCES document_stages(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, manifest JSONB NOT NULL, document_hash TEXT NOT NULL,
      target_profile_id TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await db.query('LOCK TABLE learnweave_course_definitions IN SHARE ROW EXCLUSIVE MODE');
    const rows = (await db.query('SELECT * FROM learnweave_templates ORDER BY stage_id')).rows;
    const existing = (await db.query('SELECT * FROM learnweave_course_definitions')).rows;
    const native = (await db.query(`SELECT s.id,s.data,
      COALESCE((SELECT jsonb_agg(c.data ORDER BY c.scene_order,c.id) FROM document_scenes c
        WHERE c.stage_id=s.id),'[]'::jsonb) scenes FROM document_stages s
      WHERE s.id IN (SELECT stage_id FROM learnweave_templates)`)).rows;
    const ledger = (await db.query("SELECT * FROM openmaic_schema_migrations WHERE store='learnweave-templates'")).rows;
    const backup = { rows, existing, native, ledger };
    let backupPath;
    if (apply) {
      const folder = process.env.OPENMAIC_MIGRATION_BACKUP_DIR || join(homedir(), '.local/state/openmaic/backups');
      await mkdir(folder, { recursive: true, mode: 0o700 });
      backupPath = join(folder, `learnweave-template-retirement-${Date.now()}.json`);
      await writeFile(backupPath, JSON.stringify(backup, null, 2), { mode: 0o600, flag: 'wx' });
    }
    let migrated = 0, preserved = 0;
    for (const row of rows) {
      if (existing.some((x) => x.stage_id === row.stage_id)) { preserved++; continue; }
      const doc = native.find((s) => s.id === row.stage_id);
      if (!doc) throw Error(`原生课程缺失：${row.stage_id}`);
      const manifest = convertManifest(row, doc.data, doc.scenes, spec);
      // A draft is deliberately unverified. Explicit save via the current service is required.
      await db.query(`INSERT INTO learnweave_course_definitions
        (stage_id,revision,manifest,document_hash,target_profile_id) VALUES($1,$2,$3,'',$4)`,
      [row.stage_id, row.revision, manifest, spec.profile.id]);
      migrated++;
    }
    const missing = (await db.query(`SELECT count(*)::int n FROM learnweave_templates t
      LEFT JOIN learnweave_course_definitions c USING(stage_id) WHERE c.stage_id IS NULL`)).rows[0].n;
    if (missing) throw Error(`有 ${missing} 条记录未迁移`);
    await db.query('DROP TABLE learnweave_templates');
    await db.query("DELETE FROM openmaic_schema_migrations WHERE store='learnweave-templates'");
    await db.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({ apply, migrated, preserved, backupPath,
      message: '迁移草稿须检查教法、结束策略和课程配置，再显式保存；未自动发布' }));
  } catch (e) { await db.query('ROLLBACK'); throw e; }
  finally { await db.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
