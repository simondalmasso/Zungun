import { DatabaseSync } from 'node:sqlite';
import { canonicalize, sha256Hex, type CanonicalValue } from '../../../packages/protocol-core/src/canonical.js';
import { MIGRATIONS } from './migrations.js';

export class ReceiverDatabase {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;',
    );
  }

  migrate(nowMs = Date.now()): readonly number[] {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at_ms INTEGER NOT NULL);',
    );
    const applied: number[] = [];
    for (const migration of MIGRATIONS) {
      const existing = this.db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version);
      if (existing) continue;
      this.transaction(() => {
        this.db.exec(migration.sql);
        this.db.prepare(
          'INSERT INTO schema_migrations(version,name,applied_at_ms) VALUES(?,?,?)',
        ).run(migration.version, migration.name, nowMs);
      });
      applied.push(migration.version);
    }
    return Object.freeze(applied);
  }

  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  readiness(): { readonly migrationCount: number; readonly queryOk: true } {
    const query = this.db.prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined;
    if (query?.ok !== 1) throw new Error('DATABASE_NOT_READY');
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count?: number };
    if (Number(row.count) !== MIGRATIONS.length) throw new Error('MIGRATIONS_INCOMPLETE');
    return Object.freeze({ migrationCount: Number(row.count), queryOk: true });
  }

  checkpoint(): void {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  }

  close(): void {
    this.checkpoint();
    this.db.close();
  }
}

export function evidenceHash(input: {
  source: string;
  kind: string;
  occurredAtMs: number;
  reference: string;
  payload: Readonly<Record<string, CanonicalValue>>;
}): string {
  return `sha256:${sha256Hex(canonicalize({
    source: input.source,
    kind: input.kind,
    occurredAtMs: input.occurredAtMs,
    reference: input.reference,
    payload: input.payload,
  }))}`;
}
