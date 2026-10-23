import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.env.RUN_LEARNWEAVE_RETIREMENT_DB !== '1')('one-time retirement transaction', () => {
  it('previews, preserves existing definitions, backs up, drops the old table and is repeatable', async () => {
    process.loadEnvFile('.env.local');
    const schema = `retire_${randomUUID().replaceAll('-', '')}`;
    const root = new Client({ connectionString: process.env.DATABASE_URL });
    await root.connect();
    const home = mkdtempSync(join(tmpdir(), 'openmaic-retire-'));
    try {
      await root.query(`CREATE SCHEMA ${schema}`);
      await root.query(`SET search_path TO ${schema}`);
      await root.query(`CREATE TABLE document_stages(id text PRIMARY KEY,data jsonb);
        CREATE TABLE document_scenes(stage_id text,id text,scene_order int,data jsonb);
        CREATE TABLE learnweave_templates(stage_id text, revision int,manifest jsonb);
        CREATE TABLE openmaic_schema_migrations(store text);
        INSERT INTO openmaic_schema_migrations VALUES('learnweave-templates');
        INSERT INTO document_stages VALUES('new','{"name":"New"}'),('existing','{"name":"Existing"}');
        CREATE TABLE learnweave_course_definitions(stage_id text PRIMARY KEY,
          revision int,manifest jsonb,document_hash text,target_profile_id text);
        INSERT INTO learnweave_course_definitions VALUES('existing',9,'{"keep":true}','verified','profile');`);
      const old = { activities: [{ id: 'activity', title: 'Title', contentRef: 'slide', templateId: 'teaching.picture-talk' }] };
      for (const id of ['new', 'existing']) await root.query('INSERT INTO learnweave_templates VALUES($1,3,$2)', [id, old]);
      const url = new URL(process.env.DATABASE_URL!);
      url.searchParams.set('options', `-c search_path=${schema}`);
      const run = (apply = false) => execFileSync(process.execPath,
        ['scripts/migrate-learnweave-templates.mjs', ...(apply ? ['--apply'] : [])],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DATABASE_URL: url.href, OPENMAIC_MIGRATION_BACKUP_DIR: home } });
      expect(JSON.parse(run())).toMatchObject({ apply: false, migrated: 1, preserved: 1 });
      expect((await root.query('SELECT count(*)::int n FROM learnweave_templates')).rows[0].n).toBe(2);
      // Failed conversion rolls back without dropping the source table.
      await root.query("UPDATE learnweave_templates SET manifest='{}' WHERE stage_id='new'");
      expect(() => run(true)).toThrow();
      expect((await root.query('SELECT count(*)::int n FROM learnweave_templates')).rows[0].n).toBe(2);
      await root.query("UPDATE learnweave_templates SET manifest=$1 WHERE stage_id='new'", [old]);
      const result = JSON.parse(run(true));
      expect(result).toMatchObject({ apply: true, migrated: 1, preserved: 1 });
      expect(JSON.parse(readFileSync(result.backupPath, 'utf8')).rows).toHaveLength(2);
      expect((await root.query("SELECT * FROM learnweave_course_definitions WHERE stage_id='existing'")).rows[0]).toMatchObject({ revision: 9, document_hash: 'verified', manifest: { keep: true } });
      expect((await root.query("SELECT * FROM learnweave_course_definitions WHERE stage_id='new'")).rows[0]).toMatchObject({ revision: 3, document_hash: '', manifest: { activities: [{ id: 'activity' }] } });
      expect((await root.query("SELECT to_regclass('learnweave_templates') t")).rows[0].t).toBeNull();
      expect((await root.query('SELECT * FROM openmaic_schema_migrations')).rows).toEqual([]);
      expect(run(true)).toContain('无需迁移');
    } finally {
      await root.query(`DROP SCHEMA ${schema} CASCADE`);
      await root.end();
      rmSync(home, { recursive: true, force: true });
    }
  }, 30000);
});
