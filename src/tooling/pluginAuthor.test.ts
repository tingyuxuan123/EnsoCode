import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initPlugin, runPluginAuthor, validatePluginDirectory } from './pluginAuthor';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const hostVersion = '0.2.48';
let temp: string;
beforeEach(async () => {
  temp = await mkdtemp(join(await realpath(tmpdir()), 'enso-author-test-'));
});
afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});
async function fixture(patch: Record<string, unknown> = {}) {
  const dir = join(temp, 'source');
  await mkdir(dir);
  await writeFile(
    join(dir, 'enso-plugin.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'local.test.plugin',
      name: 'Test',
      version: '1.0.0',
      permissions: [],
      main: 'main.mjs',
      ...patch,
    })
  );
  // Even a syntactically invalid entry must be validated without execution/import.
  await writeFile(
    join(dir, 'main.mjs'),
    'throw new Error("MUST NOT EXECUTE"); invalid javascript !'
  );
  return dir;
}

describe('本地插件作者工具', () => {
  it('只静态复用安装校验，不执行 main / renderer，也不修改源目录', async () => {
    const dir = await fixture({ renderer: 'ui.js', permissions: ['ui.slot'], mystery: true });
    await writeFile(join(dir, 'ui.js'), 'throw new Error("MUST NOT EXECUTE");');
    const before = await readFile(join(dir, 'enso-plugin.json'), 'utf8');
    const result = await validatePluginDirectory(dir, hostVersion);
    expect(result).toMatchObject({
      ok: true,
      manifest: { id: 'local.test.plugin' },
      warnings: ['忽略未知字段 mystery'],
    });
    expect(await readFile(join(dir, 'enso-plugin.json'), 'utf8')).toBe(before);
    expect((await readdir(dir)).sort()).toEqual(['enso-plugin.json', 'main.mjs', 'ui.js']);
  });
  it.each([
    { id: '../escape' },
    { schemaVersion: 2 },
    { main: '../main.mjs' },
    { main: 'missing.mjs' },
    { engines: { enso: '>=99.0.0' } },
    { contributes: { triggers: [{ symbol: '#', name: 'demo' }] } },
  ])('复用真实清单/引用拒绝规则 %j', async (patch) => {
    expect((await validatePluginDirectory(await fixture(patch), hostVersion)).ok).toBe(false);
  });
  it('坏 JSON 和超大清单返回失败', async () => {
    const dir = await fixture();
    for (const content of ['{bad json', ' '.repeat(256 * 1024 + 1)]) {
      await writeFile(join(dir, 'enso-plugin.json'), content);
      expect((await validatePluginDirectory(dir, hostVersion)).ok).toBe(false);
    }
  });
  it('未引用的 symlink 和硬链接仍拒绝', async () => {
    const dir = await fixture();
    const outside = join(temp, 'outside');
    await writeFile(outside, 'outside');
    await symlink(outside, join(dir, 'escape'));
    expect((await validatePluginDirectory(dir, hostVersion)).ok).toBe(false);
    await rm(join(dir, 'escape'));
    await link(outside, join(dir, 'hardlink'));
    expect((await validatePluginDirectory(dir, hostVersion)).ok).toBe(false);
    expect(await readFile(outside, 'utf8')).toBe('outside');
  });
  it('源目录 symlink 拒绝', async () => {
    const dir = await fixture();
    await symlink(dir, join(temp, 'alias'));
    expect((await validatePluginDirectory(join(temp, 'alias'), hostVersion)).ok).toBe(false);
  });
  it.each([false, true])(
    'init 产生可独立复制并静态验证的模板（已有空目录 %s）',
    async (existing) => {
      const dir = join(temp, 'new-plugin');
      if (existing) await mkdir(dir);
      await initPlugin(dir, 'local.example.hello', { repositoryRoot });
      const result = await validatePluginDirectory(dir, hostVersion);
      expect(result).toMatchObject({
        ok: true,
        manifest: { id: 'local.example.hello', main: 'main.mjs', renderer: 'ui.js' },
      });
      const types = await readFile(join(dir, 'enso-plugin.d.ts'), 'utf8');
      expect(types).not.toMatch(/@shared|\.\.\/|src\//);
      expect(await readFile(join(dir, 'ui.js'), 'utf8')).toContain('expect: snapshot');
      expect(await readdir(temp)).toEqual(['new-plugin']);
    }
  );
  it.each(['../escape', 'Local.bad', 'single', 'a.b/'.repeat(20)])(
    '坏 id 不创建文件 %s',
    async (id) => {
      await expect(initPlugin(join(temp, 'new-plugin'), id, { repositoryRoot })).rejects.toThrow();
      expect(await readdir(temp)).toEqual([]);
    }
  );
  it('非空目录不覆盖，保留隐藏文件', async () => {
    const dir = join(temp, 'existing');
    await mkdir(dir);
    await writeFile(join(dir, '.keep'), 'original');
    await expect(initPlugin(dir, 'local.test.plugin', { repositoryRoot })).rejects.toThrow();
    expect(await readdir(dir)).toEqual(['.keep']);
    expect(await readFile(join(dir, '.keep'), 'utf8')).toBe('original');
  });
  it('目标及祖先 symlink 均不允许写出目录', async () => {
    const outside = join(temp, 'outside');
    await mkdir(outside);
    await symlink(outside, join(temp, 'alias'));
    for (const dir of [join(temp, 'alias'), join(temp, 'alias', 'new')])
      await expect(initPlugin(dir, 'local.test.plugin', { repositoryRoot })).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  });
  it.each([false, true])(
    '中途模板读取失败只清理自己创建的临时文件（原目录存在 %s）',
    async (existing) => {
      const dir = join(temp, 'new-plugin');
      if (existing) await mkdir(dir);
      const broken = join(temp, 'broken-template');
      await mkdir(broken);
      await writeFile(
        join(broken, 'enso-plugin.json'),
        await readFile(join(repositoryRoot, 'examples/plugins/starter/enso-plugin.json'))
      );
      await writeFile(join(broken, 'main.mjs'), 'export function activate() {}');
      await expect(
        initPlugin(dir, 'local.test.plugin', { repositoryRoot, templateRoot: broken })
      ).rejects.toMatchObject({ code: 'ENOENT', path: join(broken, 'ui.js') });
      expect(existsSync(dir)).toBe(existing);
      expect((await readdir(temp)).sort()).toEqual(
        existing ? ['broken-template', 'new-plugin'] : ['broken-template']
      );
      if (existing) expect(await readdir(dir)).toEqual([]);
    }
  );
  it('CLI 严格解析命令、返回非零失败、校验只报告而不安装/启用', async () => {
    const messages: string[] = [];
    const options = {
      repositoryRoot,
      stdout: (text: string) => messages.push(text),
      stderr: (text: string) => messages.push(text),
    };
    expect(
      await runPluginAuthor(
        ['init', join(temp, 'new-plugin'), '--id', 'local.test.plugin'],
        options
      )
    ).toBe(0);
    expect(await runPluginAuthor(['validate', join(temp, 'new-plugin')], options)).toBe(0);
    expect(messages.join('\n')).toContain('local.test.plugin');
    for (const args of [
      [],
      ['validate'],
      ['validate', temp, '--execute'],
      ['init', temp],
      ['init', temp, '--id', 'a.b', '--force'],
    ])
      expect(await runPluginAuthor(args, options)).toBe(1);
  });
  it('真实 Node CLI 可从仓库外生成、校验并用独立声明检查模板', async () => {
    const scratch = join(temp, 'scratch');
    await mkdir(scratch);
    const cwd = temp;
    const env = { ...process.env, TMPDIR: scratch, TEMP: scratch, TMP: scratch };
    const cli = join(repositoryRoot, 'scripts/plugin-author.mjs');
    const initialized = await exec(
      process.execPath,
      [cli, 'init', 'new-plugin', '--id', 'local.test.plugin'],
      {
        cwd,
        env,
      }
    );
    const result = await exec(process.execPath, [cli, 'validate', 'new-plugin'], { cwd, env });
    expect(result.stdout).toContain('local.test.plugin v0.1.0');
    expect(initialized.stderr + result.stderr).not.toMatch(/dependency scan|vite:dep-scan/);
    expect(await readdir(scratch)).toEqual([]);

    // Only the parent supplies development dependencies, never the installable source directory.
    await symlink(join(repositoryRoot, 'node_modules'), join(temp, 'node_modules'), 'junction');
    const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
    await exec(process.execPath, [tsc, '-p', join(temp, 'new-plugin/jsconfig.json')], { cwd, env });
  }, 15_000);
});
