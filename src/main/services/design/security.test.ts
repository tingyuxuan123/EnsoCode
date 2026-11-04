import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkedPath, isDesignWritePath, isRelativePath } from './security';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
describe('设计路径边界', () => {
  it.each(['/etc/passwd', '../x', 'a/../b', 'C:/x', 'C:x', 'a\\b', 'a\0b', '//host/x'])(
    '拒绝逃逸路径 %s',
    (p) => expect(isRelativePath(p)).toBe(false)
  );
  it.each(['', 'a.vetd/frames/a.tsx', '中文/画稿.vetd', './a'])('接受根内 POSIX 路径 %s', (p) =>
    expect(isRelativePath(p)).toBe(true)
  );
  it.each([
    'a.vetd',
    'nested/a.vetd/.notes.json',
    'a.vetd/.snapshots/a.jpg',
    'a.vetd/.gitignore',
    'a.vetd.d/design.json',
    'a.vetd.migrating',
    'a.vetdz',
    'design-resources/system/theme.css',
    'app-frames-2.pdf',
    'app-frames/a.png',
  ])('只放行设计约定写目标 %s', (p) => expect(isDesignWritePath(p)).toBe(true));
  it.each([
    '',
    '.',
    '.gitignore',
    'notes.json',
    'src/a.tsx',
    'package.json',
    'x.vetd-more/a',
    'design-resources',
    'app-frames/a.tsx',
    'a.vetd/../../.env',
    '.git/a.vetd/config',
    'node_modules/a.vetd/package.json',
  ])('不开放普通项目文件 %s', (p) => expect(isDesignWritePath(p)).toBe(false));
  it('存在路径与新路径均拒绝符号链接逃逸，根内非设计文件也不能被别名写入', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'design-boundary-'));
    temps.push(root);
    const outside = await mkdtemp(path.join(os.tmpdir(), 'design-outside-'));
    temps.push(outside);
    await mkdir(path.join(root, 'a.vetd'));
    await writeFile(path.join(outside, 'secret'), 'secret');
    // 'junction' is the unprivileged Windows directory link; POSIX ignores the type.
    await symlink(outside, path.join(root, 'a.vetd', 'escape'), 'junction');
    await symlink(root, path.join(root, 'a.vetd', 'inside'), 'junction');
    await expect(checkedPath(root, 'a.vetd/escape/secret')).rejects.toMatchObject({
      code: 'OUT_OF_ROOT',
    });
    await expect(checkedPath(root, 'a.vetd/escape/new/deep')).rejects.toMatchObject({
      code: 'OUT_OF_ROOT',
    });
    await expect(checkedPath(root, 'a.vetd/inside/.env', true)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(await checkedPath(root, 'a.vetd/new/file', true)).toBe(
      path.join(await realpath(root), 'a.vetd/new/file')
    );
  });
  it('会话 cwd 已是设计包时允许包内写入，但不能删除权威根本身', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'design-package-root-'));
    temps.push(parent);
    const root = path.join(parent, 'a.vetd');
    await mkdir(root);
    expect(await checkedPath(root, 'frames/new.tsx', true)).toBe(
      path.join(await realpath(root), 'frames/new.tsx')
    );
    await expect(checkedPath(root, '', true)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
