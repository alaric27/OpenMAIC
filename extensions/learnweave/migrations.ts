// Keep startup migration checks independent of runtime persistence and tools.
import type { SchemaMigrationSet } from '@openmaic/storage/pg-migrations';

export const LEARNWEAVE_COURSE_MIGRATIONS: SchemaMigrationSet = {
  store: 'learnweave-courses', migrations: [{ version: 1, name: 'single-course-protocol', up: `CREATE TABLE IF NOT EXISTS learnweave_course_definitions (
    stage_id TEXT PRIMARY KEY REFERENCES document_stages(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL, manifest JSONB NOT NULL, document_hash TEXT NOT NULL,
    target_profile_id TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );` }],
};
