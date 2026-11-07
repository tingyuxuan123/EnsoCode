import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contentHash } from './contentHash';
import {
  CONTENT_HASH_BACKFILL_BATCH,
  hasVec,
  MAX_EMBEDDING_DIM,
  MEMORY_SCHEMA_VERSION,
  openMemoryDb,
  vecTableName,
} from './db';
import { encodeEmbedding } from './store';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'enso-memory-db-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('openMemoryDb', () => {
  it('creates parent directories and applies schema', () => {
    const db = openMemoryDb(path.join(dir, 'nested', 'memory.db'));
    const version = db.pragma('user_version', { simple: true });
    expect(version).toBe(MEMORY_SCHEMA_VERSION);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger') ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(['memories', 'memories_fts']));
    expect(tables).toEqual(expect.arrayContaining(['memories_ai', 'memories_ad', 'memories_au']));
    db.close();
  });

  it('v4 content_hash 回填在主迁移事务之外分批进行，且可重入（Minor 4）', () => {
    const file = path.join(dir, 'backfill.db');
    const legacy = openMemoryDb(file);
    const insert = legacy.prepare(
      `INSERT INTO memories (id, title, content, semantic_field, space_id, created_at, updated_at)
       VALUES (?, 't', ?, 't', 'global', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')`
    );
    const n = CONTENT_HASH_BACKFILL_BATCH * 2 + 3;
    legacy.transaction(() => {
      for (let i = 0; i < n; i++) insert.run(`m${i}`, `body ${i}`);
    })();
    legacy.exec('UPDATE memories SET content_hash = NULL');
    legacy.pragma('user_version = 3');
    legacy.close();

    const db = openMemoryDb(file);
    expect(db.pragma('user_version', { simple: true })).toBe(MEMORY_SCHEMA_VERSION);
    const missing = (
      db.prepare('SELECT count(*) AS n FROM memories WHERE content_hash IS NULL').get() as {
        n: number;
      }
    ).n;
    expect(missing).toBe(0);
    const row = db.prepare('SELECT content_hash FROM memories WHERE id = ?').get('m5') as {
      content_hash: string;
    };
    expect(row.content_hash).toBe(contentHash('body 5'));
    db.close();
  });

  it('is idempotent on reopen', () => {
    const file = path.join(dir, 'memory.db');
    openMemoryDb(file).close();
    const db = openMemoryDb(file);
    expect(db.pragma('user_version', { simple: true })).toBe(MEMORY_SCHEMA_VERSION);
    db.close();
  });

  it('rejects unit_type outside the closed set (CHECK)', () => {
    const db = openMemoryDb(path.join(dir, 'memory.db'));
    expect(() =>
      db
        .prepare(
          `INSERT INTO memories (id, title, content, semantic_field, unit_type, space_id, created_at, updated_at)
           VALUES ('x', 't', 'c', 't\nc', 'crystal', 'global', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')`
        )
        .run()
    ).toThrow(/CHECK/);
    db.close();
  });

  it('loads sqlite-vec by default; a broken extension path degrades instead of throwing', () => {
    const ok = openMemoryDb(path.join(dir, 'ok.db'));
    expect(hasVec(ok)).toBe(true);
    ok.close();
    const broken = openMemoryDb(path.join(dir, 'broken.db'), {
      vecExtensionPath: path.join(dir, 'no-such-extension'),
    });
    expect(hasVec(broken)).toBe(false);
    expect(broken.pragma('user_version', { simple: true })).toBe(MEMORY_SCHEMA_VERSION);
    broken.close();
    const off = openMemoryDb(path.join(dir, 'off.db'), { vecExtensionPath: null });
    try {
      expect(hasVec(off)).toBe(false);
    } finally {
      off.close();
    }
  });

  it('vecTableName rejects unsafe dimensions', () => {
    expect(vecTableName(384)).toBe('memory_vec_384');
    expect(vecTableName(MAX_EMBEDDING_DIM)).toBe(`memory_vec_${MAX_EMBEDDING_DIM}`);
    // 离谱但合法的安全整数也要拒：vec0 会真的去建一张 2^53 维的表
    for (const bad of [0, -1, 1.5, Number.NaN, MAX_EMBEDDING_DIM + 1, 2 ** 53 - 1, 2 ** 53]) {
      expect(() => vecTableName(bad)).toThrow(/dimension/);
    }
  });

  it('backfills legacy BLOB embeddings into per-dim vec tables on open (reentrant)', () => {
    const file = path.join(dir, 'legacy.db');
    // 模拟扩展不可用时写入的旧数据：只有 BLOB，没有 vec 表
    const legacy = openMemoryDb(file, { vecExtensionPath: null });
    const INSERT = `INSERT INTO memories (id, title, content, semantic_field, space_id, created_at, updated_at,
         embedding, embedding_model, embedding_dim, embedding_version)
       VALUES (?, 't', 'c', 't\nc', 'global', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', ?, ?, ?, 1)`;
    legacy.prepare(INSERT).run('a', encodeEmbedding(Float32Array.from([1, 0])), 'm2', 2);
    legacy.prepare(INSERT).run('b', encodeEmbedding(Float32Array.from([0, 0, 1])), 'm3', 3);
    legacy.pragma('user_version = 1');
    legacy.close();

    const count = (db: ReturnType<typeof openMemoryDb>, dim: number) =>
      (db.prepare(`SELECT count(*) AS n FROM ${vecTableName(dim)}`).get() as { n: number }).n;
    let db = openMemoryDb(file);
    expect(db.pragma('user_version', { simple: true })).toBe(MEMORY_SCHEMA_VERSION);
    expect(count(db, 2)).toBe(1);
    expect(count(db, 3)).toBe(1);
    // 再次打开不重复插入；中途新增的 BLOB 行也会被补齐
    db.prepare(INSERT).run('c', encodeEmbedding(Float32Array.from([0, 1])), 'm2', 2);
    db.close();
    db = openMemoryDb(file);
    expect(count(db, 2)).toBe(2);
    expect(count(db, 3)).toBe(1);
    db.close();
  });

  it('keeps FTS in sync through insert/update/delete triggers', () => {
    const db = openMemoryDb(path.join(dir, 'memory.db'));
    const insert = db.prepare(
      `INSERT INTO memories (id, title, content, semantic_field, space_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'global', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')`
    );
    insert.run('a', 'Postgres', 'primary database', 'Postgres\nprimary database');
    const count = () =>
      (
        db
          .prepare('SELECT count(*) AS n FROM memories_fts WHERE memories_fts MATCH \'"database"\'')
          .get() as {
          n: number;
        }
      ).n;
    expect(count()).toBe(1);
    db.prepare(
      "UPDATE memories SET content = 'cache', semantic_field = 'Postgres\ncache' WHERE id = 'a'"
    ).run();
    expect(count()).toBe(0);
    db.prepare("DELETE FROM memories WHERE id = 'a'").run();
    expect((db.prepare('SELECT count(*) AS n FROM memories_fts').get() as { n: number }).n).toBe(0);
    db.close();
  });
});
