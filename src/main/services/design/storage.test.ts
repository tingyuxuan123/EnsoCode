import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DesignStorage } from './storage';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
it('提交和快照原子共享 revision，冲突不会部分写盘，重启可读取', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-storage-'));
  temps.push(dir);
  const store = new DesignStorage(dir);
  const initial = await store.request({ op: 'readSnapshot', paths: ['a'], encoding: 'utf8' });
  expect(initial).toMatchObject({ files: { a: null } });
  if (!('revision' in initial)) throw new Error('missing revision');
  await store.request({
    op: 'commit',
    expectedRevision: initial.revision,
    changes: [
      { type: 'write', path: 'a', data: '你好', encoding: 'utf8' },
      { type: 'write', path: 'b', data: 'AQI=', encoding: 'base64' },
    ],
  });
  await expect(
    store.request({
      op: 'commit',
      expectedRevision: initial.revision,
      changes: [{ type: 'remove', path: 'a' }],
    })
  ).rejects.toThrow('REVISION_CONFLICT');
  const snapshot = await new DesignStorage(dir).request({
    op: 'readSnapshot',
    paths: ['a', 'b'],
    encoding: 'utf8',
  });
  expect(snapshot).toMatchObject({ files: { a: '你好', b: '\x01\x02' } });
  await expect(
    store.request({
      op: 'commit',
      changes: [{ type: 'write', path: '../escape', data: 'x', encoding: 'utf8' }],
    })
  ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
});
it('特殊对象键也按普通相对文件名存储，不能污染快照原型', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-storage-'));
  temps.push(dir);
  const store = new DesignStorage(dir);
  await store.request({
    op: 'commit',
    changes: [{ type: 'write', path: '__proto__', data: 'safe', encoding: 'utf8' }],
  });
  expect(await store.request({ op: 'readFile', path: '__proto__', encoding: 'utf8' })).toEqual({
    ok: true,
    data: 'safe',
  });
});
