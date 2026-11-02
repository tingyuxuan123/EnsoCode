import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openMemoryDb } from './memory/db';
import { buildTranscript, distillFingerprint, ensureDistillJob } from './memory/distill';
import { writeTinyModel2Vec } from './memory/embedding/model2vec.fixture';
import { embeddingModelDirName, resolveEmbeddingModelSpec } from './memory/embedding/registry';
import { ensureKgJob } from './memory/kg';
import { ensureReembedJob } from './memory/reembed';
import { createMemory } from './memory/store';

let userData: string;
let fixtureDb: ReturnType<typeof openMemoryDb> | null = null;
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

import {
  awaitMemoryDistill,
  awaitMemoryEmbeddingClose,
  awaitMemoryKg,
  awaitMemoryReembed,
  closeMemoryDb,
  configureMemoryDistill,
  configureMemoryEmbedding,
  configureMemoryKg,
  memoryDatabase,
  retryFailedMemoryKg,
} from './memoryHost';

beforeEach(async () => {
  userData = mkdtempSync(path.join(tmpdir(), 'enso-memory-cold-retry-'));
  configureMemoryDistill({ enabled: false, complete: null });
  configureMemoryKg({ enabled: false, complete: null });
  closeMemoryDb();
  await awaitMemoryReembed();
});

afterEach(async () => {
  configureMemoryDistill({ enabled: false, complete: null });
  configureMemoryKg({ enabled: false, complete: null });
  await awaitMemoryDistill();
  await awaitMemoryReembed();
  closeMemoryDb();
  await awaitMemoryEmbeddingClose();
  if (fixtureDb?.open) fixtureDb.close();
  fixtureDb = null;
  rmSync(userData, { recursive: true, force: true });
});

describe('冷库 KG retry 不接管 host 初始化', () => {
  it.each(['distill', 'reembed', 'kg'] as const)(
    '重试只 reset，随后正常访问仍续跑既有 pending %s',
    async (kind) => {
      const spec = resolveEmbeddingModelSpec('local:potion-multilingual-128M')!;
      const modelDir = path.join(userData, 'memory', 'models', embeddingModelDirName(spec));
      const vector = Array(256).fill(0);
      vector[0] = 1;
      writeTinyModel2Vec(modelDir, { tokens: ['redis'], rows: [vector] });
      writeFileSync(path.join(modelDir, '.ready'), '{}');
      configureMemoryEmbedding({ modelId: spec.id, autoDownload: false });
      await awaitMemoryReembed();

      const database = openMemoryDb(path.join(userData, 'memory', 'memory.db'));
      fixtureDb = database;
      const memory = await createMemory(database, { content: 'redis baseline', spaceId: 'global' });
      if (memory.status !== 'inserted') throw new Error('fixture insert failed');
      const kg = ensureKgJob(database, memory.memory.id)!;
      database
        .prepare("UPDATE memory_jobs SET status='done', failed=1, error='bad JSON' WHERE id=?")
        .run(kg.id);
      const messages = [{ role: 'user' as const, text: 'redis distill resume' }];
      const distill = ensureDistillJob(
        database,
        { sessionId: 'cold-resume', sessionFile: '/fixture.jsonl', projectId: null },
        distillFingerprint('cold-resume', buildTranscript(messages))
      )!;
      const reembed = ensureReembedJob(database, spec.id)!;
      const jobId = kind === 'distill' ? distill.id : kind === 'reembed' ? reembed.id : kg.id;
      const complete = vi.fn(async () => '{"memories":[]}');
      const kgComplete = vi.fn(async () => '{"entities":[],"relationships":[]}');
      configureMemoryDistill({
        enabled: true,
        readTranscript: async () => messages,
        complete: () => complete,
      });
      configureMemoryKg({ enabled: kind === 'kg', complete: () => kgComplete });
      const status = (id: number) =>
        database.prepare('SELECT status FROM memory_jobs WHERE id=?').get(id);

      expect(retryFailedMemoryKg()).toBe(1);
      expect(retryFailedMemoryKg()).toBe(0);
      await awaitMemoryKg();
      await awaitMemoryReembed();
      expect(status(jobId)).toEqual({ status: 'pending' });
      expect(status(kg.id)).toEqual({ status: 'pending' });
      expect(complete).not.toHaveBeenCalled();
      expect(kgComplete).not.toHaveBeenCalled();

      configureMemoryKg({ enabled: true });
      memoryDatabase();
      await awaitMemoryDistill();
      await awaitMemoryReembed();
      try {
        expect(status(jobId)).toEqual({ status: 'done' });
        expect(status(kg.id)).toEqual({ status: 'done' });
        expect(complete).toHaveBeenCalledTimes(1);
        expect(kgComplete).toHaveBeenCalledTimes(1);
      } finally {
        database.close();
      }
    }
  );
});
