// Keep startup migration checks independent of runtime persistence and tools.
import type { SchemaMigrationSet } from '@openmaic/storage/pg-migrations';

export const LEARNWEAVE_MIGRATIONS: SchemaMigrationSet = {
  store: 'learnweave-templates',
  migrations: [
    {
      version: 1,
      name: 'activity-manifest',
      up: `CREATE TABLE IF NOT EXISTS learnweave_templates (
    stage_id TEXT PRIMARY KEY REFERENCES document_stages(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('pending','ready')),
    manifest JSONB NOT NULL,
    fingerprint TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    },
  ],
};
