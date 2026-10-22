import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalWorkspace } from './local';

let root: string;
const signal = new AbortController().signal;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'enso-code-search-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (rel: string, content: string) => {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
};

describe('LocalWorkspace 边界', () => {
  it('拒绝绝对路径的搜索子目录', async () => {
    await expect(LocalWorkspace.create(root, '/etc', signal)).rejects.toMatchObject({
      code: 'path',
    });
  });

  it('拒绝包含 .. 的搜索子目录', async () => {
    await expect(LocalWorkspace.create(root, '../outside', signal)).rejects.toMatchObject({
      code: 'path',
    });
  });

  it('拒绝搜索子目录里的符号链接', async () => {
    mkdirSync(join(root, 'outside'));
    symlinkSync(join(root, 'outside'), join(root, 'link'));
    await expect(LocalWorkspace.create(root, 'link', signal)).rejects.toMatchObject({
      code: 'path',
    });
  });

  it('扫描时跳过符号链接，不读取链接目标', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'enso-code-search-outside-'));
    try {
      writeFileSync(join(outside, 'secret.txt'), 'needle outside');
      write('inside.txt', 'needle inside');
      symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.txt'));
      const workspace = await LocalWorkspace.create(root, undefined, signal);
      const output = await workspace.execute({ op: 'rg', pattern: 'needle' });
      expect(output).toContain('inside.txt');
      expect(output).not.toContain('leak.txt');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('gitignore 继承', () => {
  it('选择子目录后仍排除 cwd 与父级声明的文件且允许未忽略文件', async () => {
    write('.gitignore', '*.log\n');
    write('sub/.gitignore', '*.tmp\n');
    write('sub/deep/hidden.log', 'needle parent');
    write('sub/deep/hidden.tmp', 'needle sub');
    write('sub/deep/good.ts', 'needle allowed');
    const workspace = await LocalWorkspace.create(root, 'sub/deep', signal);
    const output = await workspace.execute({ op: 'rg', pattern: 'needle' });
    expect(output).toContain('good.ts');
    expect(output).not.toContain('hidden.log');
    expect(output).not.toContain('hidden.tmp');
    await expect(workspace.snippet('/codebase/hidden.log', 1, 1)).rejects.toMatchObject({
      code: 'path',
    });
  });

  it('不能用显式子目录跳过被父级忽略的整个目录', async () => {
    write('.gitignore', 'hidden/\n');
    write('hidden/ok.ts', 'needle');
    const workspace = await LocalWorkspace.create(root, 'hidden', signal);
    await expect(workspace.execute({ op: 'rg', pattern: 'needle' })).rejects.toMatchObject({
      code: 'path',
    });
  });
  it('子目录 negation 可以放开父目录忽略，硬排除不能放开', async () => {
    write('.gitignore', '*.log\n.env\n');
    write('sub/.gitignore', '!keep.log\n!.env\n');
    write('sub/keep.log', 'needle keep');
    write('sub/drop.log', 'needle drop');
    write('sub/.env', 'needle secret');
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    const output = await workspace.execute({ op: 'rg', pattern: 'needle' });
    expect(output).toContain('sub/keep.log');
    expect(output).not.toContain('sub/drop.log');
    expect(output).not.toContain('.env');
  });

  it('子目录路径创建时从 cwd 继承祖先 ignore 规则', async () => {
    write('.gitignore', '*.log\n');
    write('sub/keep.log', 'needle');
    write('sub/.gitignore', '!keep.log\n');
    const workspace = await LocalWorkspace.create(root, 'sub', signal);
    await expect(workspace.execute({ op: 'rg', pattern: 'needle' })).resolves.toContain(
      '/codebase/keep.log'
    );
  });
});

describe('硬排除敏感路径', () => {
  it('会话根是凭据目录时仍保留绝对路径中的敏感前缀', async () => {
    write('.kube/config', 'needle kubeconfig');
    const workspace = await LocalWorkspace.create(join(root, '.kube'), undefined, signal);
    await expect(
      workspace.execute({ op: 'readfile', path: '/codebase/config' })
    ).rejects.toMatchObject({ code: 'path' });
  });
  const blocked = [
    'my-credentials.txt',
    'secrets.ts',
    'token.json',
    'private-key.txt',
    'credentials/data.ts',
    'src/secrets/ok.ts',
    'token/cache.ts',
    'private-key/readme.md',
    '.pi/settings.json',
    '.piwin/config.json',
    '.dsh/state.json',
  ];

  for (const path of blocked) {
    it(`不向云输出 ${path} 的查读和最终片段`, async () => {
      write(path, 'needle secret');
      const workspace = await LocalWorkspace.create(root, undefined, signal);
      await expect(
        workspace.execute({ op: 'readfile', path: `/codebase/${path}` })
      ).rejects.toMatchObject({ code: 'path' });
      await expect(workspace.snippet(`/codebase/${path}`, 1, 1)).rejects.toMatchObject({
        code: 'path',
      });
    });
  }

  it('rg 不扫描任意层级的敏感 segment', async () => {
    for (const path of blocked) write(path, 'needle secret');
    write('allowed.txt', 'needle allowed');
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    const output = await workspace.execute({ op: 'rg', pattern: 'needle' });
    expect(output).toContain('allowed.txt');
    for (const path of blocked) expect(output).not.toContain(path);
  });
});

describe('fence 覆盖 cwd → root 祖先', () => {
  it('create 后替换祖先为符号链接时拒绝查读和最终片段', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'enso-code-search-outside-'));
    try {
      write('src/deep/a.ts', 'needle inside');
      writeFileSync(join(outside, 'a.ts'), 'needle outside');
      const workspace = await LocalWorkspace.create(root, 'src/deep', signal);
      renameSync(join(root, 'src'), join(root, 'src-real'));
      symlinkSync(outside, join(root, 'src'));
      await expect(
        workspace.execute({ op: 'readfile', path: '/codebase/a.ts' })
      ).rejects.toMatchObject({ code: 'path' });
      await expect(workspace.snippet('/codebase/a.ts', 1, 1)).rejects.toMatchObject({
        code: 'path',
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('取消', () => {
  it('取消后查读和最终片段都返回 cancelled', async () => {
    write('a.ts', 'needle\n');
    const controller = new AbortController();
    const workspace = await LocalWorkspace.create(root, undefined, controller.signal);
    controller.abort();
    await expect(
      workspace.execute({ op: 'readfile', path: '/codebase/a.ts' })
    ).rejects.toMatchObject({ code: 'cancelled' });
    await expect(workspace.snippet('/codebase/a.ts', 1, 1)).rejects.toMatchObject({
      code: 'cancelled',
    });
  });
});

describe('最终片段', () => {
  it('不使用命令缓存，重新读取最新内容', async () => {
    write('a.ts', 'const value = 1;\n');
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    await workspace.execute({ op: 'readfile', path: '/codebase/a.ts', start: 1, end: 1 });
    write('a.ts', 'const value = 2;\n');
    const snippet = await workspace.snippet('/codebase/a.ts', 1, 1);
    expect(snippet.content).toContain('const value = 2;');
    expect(snippet.content).not.toContain('const value = 1;');
  });

  it('超过单命令文件预算时返回显式 partial', async () => {
    for (let i = 0; i < 520; i++) write(`many/f${i}.txt`, 'nothing here');
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    const output = await workspace.execute({ op: 'rg', pattern: 'needle' });
    expect(output).toContain('[PARTIAL]');
    expect(workspace.partial).toBe(true);
  });
});
