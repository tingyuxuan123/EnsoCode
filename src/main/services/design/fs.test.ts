import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { designFsAtRoot } from './fs';

const temps: string[] = [];
const root = { kind: 'project', projectId: 'fixture' } as const;
async function temp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-fs-'));
  temps.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(temps.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
it('UTF-8 保持文本，坏 UTF-8 保持二进制，stat 不存在返回 null', async () => {
  const dir = await temp();
  await writeFile(path.join(dir, 'a'), '你好');
  await writeFile(path.join(dir, 'b'), Buffer.from([255, 254]));
  expect(await designFsAtRoot(dir, { root, op: 'readFile', rel: 'a' })).toMatchObject({
    content: '你好',
    encoding: 'utf8',
  });
  expect(await designFsAtRoot(dir, { root, op: 'readFile', rel: 'b' })).toMatchObject({
    content: '//4=',
    encoding: 'base64',
  });
  expect(await designFsAtRoot(dir, { root, op: 'stat', rel: 'missing' })).toEqual({
    ok: true,
    stat: null,
  });
});
it('遍历跳过隐藏项/默认目录/自定义目录/符号链接并精确匹配文件名', async () => {
  const dir = await temp();
  for (const sub of ['.hidden', 'node_modules', 'dist', 'ignored', 'src']) {
    await mkdir(path.join(dir, sub));
    await writeFile(path.join(dir, sub, 'design.json'), '{}');
  }
  await writeFile(path.join(dir, 'src', 'design.json.bak'), '{}');
  await symlink(path.join(dir, 'src'), path.join(dir, 'link'));
  expect(
    await designFsAtRoot(dir, {
      root,
      op: 'listFilesRecursive',
      rel: '',
      names: ['design.json'],
      ignoredDirectories: ['ignored'],
    })
  ).toEqual({ ok: true, files: [{ name: 'design.json', rel: 'src/design.json' }] });
});
it('拒绝超大读取，不给普通项目文件写权限', async () => {
  const dir = await temp();
  const file = path.join(dir, 'big');
  await writeFile(file, '');
  await truncate(file, 32 * 1024 * 1024 + 1);
  await expect(
    designFsAtRoot(dir, { root, op: 'readBinaryFile', rel: 'big' })
  ).rejects.toMatchObject({ code: 'TOO_LARGE' });
  await expect(
    designFsAtRoot(dir, {
      root,
      op: 'writeFile',
      rel: 'package.json',
      content: '{}',
      encoding: 'utf8',
    })
  ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  expect(
    await designFsAtRoot(dir, {
      root,
      op: 'writeFile',
      rel: 'a.vetd/frames/a.tsx',
      content: 'export default 1',
      encoding: 'utf8',
    })
  ).toEqual({ ok: true });
});
