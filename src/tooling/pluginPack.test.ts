import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stagePlugin } from '../main/services/extensionPlugins/install';
import { packPlugin } from './pluginPack';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(await realpath(tmpdir()), 'collabra-plugin-pack-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const dir = join(root, 'source');
  await mkdir(dir);
  await writeFile(
    join(dir, 'enso-plugin.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'local.example.pack',
      name: 'Pack',
      version: '1.0.0',
      main: 'main.mjs',
      permissions: [],
    })
  );
  await writeFile(join(dir, 'main.mjs'), 'throw new Error("must not execute");');
  return dir;
}
describe('插件确定性打包', () => {
  it('相同内容产生相同哈希，可按现有安装规则再次暂存且不执行代码', async () => {
    const dir = await fixture();
    await mkdir(join(dir, 'test'));
    await writeFile(join(dir, 'test', 'main.test.mjs'), 'not shipped');
    await writeFile(join(dir, '.hidden'), 'not shipped');
    await writeFile(join(dir, 'enso-testing.mjs'), 'not shipped');
    const first = await packPlugin(dir, { hostVersion: '1.0.0', out: join(root, 'one.zip') });
    const second = await packPlugin(dir, { hostVersion: '1.0.0', out: join(root, 'two.zip') });
    const bytes = await readFile(first.file);
    expect(second.sha256).toBe(first.sha256);
    expect(first.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(first.size).toBe(bytes.length);
    const staged = await stagePlugin(
      join(root, 'install'),
      { kind: 'zip', path: first.file },
      '1.0.0'
    );
    expect(staged.ok).toBe(true);
    if (!staged.ok) throw new Error(staged.error);
    expect(await readFile(join(staged.staged.pluginRoot, 'main.mjs'), 'utf8')).toContain(
      'must not execute'
    );
    await expect(
      readFile(join(staged.staged.pluginRoot, 'test', 'main.test.mjs'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(staged.staged.pluginRoot, '.hidden'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('拒绝缺失入口，拒绝未引用的链接，也不覆盖已有输出', async () => {
    const dir = await fixture();
    const out = join(root, 'existing.zip');
    await writeFile(out, 'original');
    await expect(packPlugin(dir, { hostVersion: '1.0.0', out })).rejects.toThrow();
    expect(await readFile(out, 'utf8')).toBe('original');
    await symlink(out, join(dir, 'unreferenced'));
    await expect(
      packPlugin(dir, { hostVersion: '1.0.0', out: join(root, 'bad.zip') })
    ).rejects.toThrow();
    await rm(join(dir, 'unreferenced'));
    await rm(join(dir, 'main.mjs'));
    await expect(
      packPlugin(dir, { hostVersion: '1.0.0', out: join(root, 'missing.zip') })
    ).rejects.toThrow();
  });
});
