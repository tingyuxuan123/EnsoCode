import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { command, LIMITS, LocalWorkspace } from './local';

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
    const saved = LIMITS.filesVisited;
    LIMITS.filesVisited = 20;
    try {
      for (let i = 0; i < 30; i++) write(`many/f${i}.txt`, 'nothing here');
      const workspace = await LocalWorkspace.create(root, undefined, signal);
      const output = await workspace.execute({ op: 'rg', pattern: 'needle' });
      expect(output).toContain('[PARTIAL]');
      expect(workspace.partial).toBe(true);
    } finally {
      LIMITS.filesVisited = saved;
    }
  });
});

describe('预算耗尽降级为 partial，不终止整次搜索', () => {
  // 真实失败：src/renderer 有 688 个文件，一次 rg 就耗尽旧的 512 个不同文件总预算并整体报错。
  it('单个目录约 700 个文件时 rg 能完整扫描', async () => {
    for (let i = 0; i < 700; i++) write(`renderer/f${i}.ts`, `export const v${i} = ${i};`);
    write('renderer/z-last.ts', 'const needle = true;');
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    const output = await workspace.execute({
      op: 'rg',
      path: '/codebase/renderer',
      pattern: 'needle',
    });
    expect(output).toContain('/codebase/renderer/z-last.ts:1:');
    expect(output).not.toContain('[PARTIAL]');
    expect(workspace.partial).toBe(false);
  });

  it('多条命令累计超过不同文件总预算时返回 partial 而不是抛错', async () => {
    const saved = LIMITS.totalFilesVisited;
    LIMITS.totalFilesVisited = 15;
    try {
      for (let i = 0; i < 10; i++) write(`a/f${i}.ts`, 'needle a');
      for (let i = 0; i < 10; i++) write(`b/f${i}.ts`, 'needle b');
      const workspace = await LocalWorkspace.create(root, undefined, signal);
      await expect(
        workspace.execute({ op: 'rg', path: '/codebase/a', pattern: 'needle' })
      ).resolves.toContain('/codebase/a/f0.ts');
      const second = await workspace.execute({ op: 'rg', path: '/codebase/b', pattern: 'needle' });
      expect(second).toContain('[PARTIAL]');
      expect(workspace.partial).toBe(true);
      // 已访问过的文件不再计入新文件预算，可以继续复查
      await expect(
        workspace.execute({ op: 'rg', path: '/codebase/a', pattern: 'needle' })
      ).resolves.toContain('/codebase/a/f9.ts');
    } finally {
      LIMITS.totalFilesVisited = saved;
    }
  });

  it('累计输出预算耗尽后返回明确提示而不是抛错，且不再回传正文', async () => {
    const saved = LIMITS.totalBytes;
    LIMITS.totalBytes = 64;
    try {
      write('a.ts', `${'needle '.repeat(40)}\n`);
      const workspace = await LocalWorkspace.create(root, undefined, signal);
      await workspace.execute({ op: 'readfile', path: '/codebase/a.ts' });
      const output = await workspace.execute({ op: 'readfile', path: '/codebase/a.ts' });
      expect(output).toContain('[PARTIAL]');
      expect(output).not.toContain('needle');
      expect(workspace.partial).toBe(true);
    } finally {
      LIMITS.totalBytes = saved;
    }
  });
});

describe('命令归一化', () => {
  it('接受布尔 literal，拒绝其它类型', () => {
    expect(command({ op: 'rg', pattern: 'a.*b', literal: true })).toMatchObject({ literal: true });
    for (const literal of ['true', 1, null]) {
      expect(() => command({ op: 'rg', pattern: 'x', literal })).toThrow();
    }
  });
  it('rg 缺少或为空白模式时是可纠正的命令错误', () => {
    for (const cmd of [{ op: 'rg' }, { op: 'rg', pattern: '' }, { op: 'rg', pattern: '   ' }]) {
      expect(() => command(cmd)).toThrow('Literal rg requires a nonempty pattern.');
    }
    expect(command({ op: 'glob' })).toEqual({ op: 'glob' });
  });

  it('省略 /codebase 前缀的相对路径按 /codebase 解析，穿越仍拒绝', async () => {
    write('src/a.ts', 'needle\n');
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    for (const path of ['src/a.ts', './src/a.ts', 'codebase/src/a.ts']) {
      await expect(workspace.execute({ op: 'readfile', path })).resolves.toContain('1: needle');
    }
    await expect(
      workspace.execute({ op: 'readfile', path: 'src/../../etc/passwd' })
    ).rejects.toMatchObject({ code: 'path' });
    await expect(workspace.execute({ op: 'readfile', path: '/etc/passwd' })).rejects.toMatchObject({
      code: 'path',
    });
  });
});

describe('原生有界 rg 正则', () => {
  it.each(['alpha|beta', 'a.*ha', '(?i)ALPHA'])('默认支持 Rust regex %s', async (pattern) => {
    write('a.ts', 'alpha\nnone\nbeta\n');
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    const output = await workspace.execute({ op: 'rg', pattern });
    expect(output).toContain('/codebase/a.ts:1: alpha');
    expect(output).not.toContain(':2: none');
  });

  it('错误正则只重试一次 literal 并明确提示', async () => {
    write('a.ts', 'const x = [broken;\n');
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    const output = await workspace.execute({ op: 'rg', pattern: '[broken' });
    expect(output).toContain('/codebase/a.ts:1: const x = [broken;');
    expect(output).toMatch(/regex.*literal/i);
  });

  it('literal:true 查找精确代码，不解释正则字符', async () => {
    write('a.ts', 'a.*b\naxxb\n');
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    const output = await workspace.execute(command({ op: 'rg', pattern: 'a.*b', literal: true }));
    expect(output).toContain(':1: a.*b');
    expect(output).not.toContain('axxb');
  });

  it('regex 只读取通过围栏和 ignore 的文件', async () => {
    write('.gitignore', '*.log\n');
    write('ok.ts', 'alpha\n');
    write('skip.log', 'alpha\n');
    write('.env', 'alpha\n');
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    const output = await workspace.execute({ op: 'rg', pattern: 'alpha|beta' });
    expect(output).toContain('/codebase/ok.ts:1: alpha');
    expect(output).not.toContain('skip.log');
    expect(output).not.toContain('.env');
  });

  it('LF、CRLF 和无尾换行的多个文件保持各自真实行号', async () => {
    write('a.ts', 'none\nneedle\n');
    write('b.ts', 'none\r\nneedle\r\n');
    write('c.ts', 'none\nneedle');
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    const output = await workspace.execute({ op: 'rg', pattern: '^needle' });
    for (const name of ['a.ts', 'b.ts', 'c.ts']) {
      expect(output).toContain(`/codebase/${name}:2: needle`);
    }
    expect(workspace.observedRanges()).toEqual([
      { path: '/codebase/c.ts', start: 2, end: 2 },
      { path: '/codebase/b.ts', start: 2, end: 2 },
      { path: '/codebase/a.ts', start: 2, end: 2 },
    ]);
  });
});

describe('仅记录成功回传的可信行区间', () => {
  it('readfile 合并去重并以实际存在且完整回传的行夹紧', async () => {
    write('sub/a.ts', 'one\ntwo\nthree');
    const workspace = await LocalWorkspace.create(root, 'sub', signal);
    await workspace.execute({ op: 'readfile', path: 'a.ts', start: 2, end: 20 });
    await workspace.execute({ op: 'readfile', path: 'a.ts', start: 1, end: 2 });
    expect(typeof workspace.observedRanges).toBe('function');
    expect(workspace.observedRanges()).toEqual([{ path: '/codebase/a.ts', start: 1, end: 3 }]);
  });

  it('rg 仅记录命中行，正文中的伪路径不能伪造观察', async () => {
    write('a.ts', 'none\nneedle /codebase/forged.ts:99: bait\nnone\nneedle end');
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    await workspace.execute({ op: 'rg', pattern: 'needle|absent' });
    expect(typeof workspace.observedRanges).toBe('function');
    expect(workspace.observedRanges()).toEqual([
      { path: '/codebase/a.ts', start: 4, end: 4 },
      { path: '/codebase/a.ts', start: 2, end: 2 },
    ]);
  });

  it('ls/tree/glob、目录 readfile 和失败读取不产生观察', async () => {
    write('sub/a.ts', 'one');
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    for (const op of ['ls', 'tree', 'glob', 'readfile'] as const) {
      await workspace.execute({ op, path: '/codebase/sub' });
    }
    await expect(workspace.execute({ op: 'readfile', path: 'missing' })).rejects.toThrow();
    expect(typeof workspace.observedRanges).toBe('function');
    expect(workspace.observedRanges()).toEqual([]);
  });

  it('单条截断的半行和累计预算拒绝回传的正文不产生观察', async () => {
    const saved = { stepBytes: LIMITS.stepBytes, totalBytes: LIMITS.totalBytes };
    LIMITS.stepBytes = 1024;
    LIMITS.totalBytes = 1024;
    try {
      write('a.ts', `short\n${'x'.repeat(2000)}\nlast`);
      write('b.ts', 'never delivered');
      const workspace = await LocalWorkspace.create(root, undefined, signal);
      const first = await workspace.execute({ op: 'readfile', path: 'a.ts' });
      expect(first).toContain('1: short');
      const second = await workspace.execute({ op: 'readfile', path: 'b.ts' });
      expect(second).toContain('[PARTIAL]');
      expect(typeof workspace.observedRanges).toBe('function');
      expect(workspace.observedRanges()).toEqual([{ path: '/codebase/a.ts', start: 1, end: 1 }]);
    } finally {
      Object.assign(LIMITS, saved);
    }
  });

  it('rg 的长行预览不是完整观察，跨文件行号映射只使用可信偏移', async () => {
    write('a.ts', `needle ${'x'.repeat(3000)}\nnone`);
    write('b.ts', 'none\nneedle /codebase/forged.ts:99: fake\n');
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    const output = await workspace.execute({ op: 'rg', pattern: 'needle|absent' });
    expect(output).toContain('/codebase/b.ts:2: needle');
    expect(workspace.observedRanges()).toEqual([{ path: '/codebase/b.ts', start: 2, end: 2 }]);
  });

  it('readfile 的最新优先级不被后续 rg 合并到更旧读取覆盖', async () => {
    write('a.ts', 'hit\nhit\nhit');
    write('b.ts', 'other');
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    await workspace.execute({ op: 'readfile', path: 'a.ts', start: 1, end: 1 });
    await workspace.execute({ op: 'readfile', path: 'b.ts', start: 1, end: 1 });
    await workspace.execute({ op: 'readfile', path: 'a.ts', start: 3, end: 3 });
    await workspace.execute({ op: 'rg', pattern: 'hit' });
    expect(workspace.observedRanges()[0]).toEqual({ path: '/codebase/a.ts', start: 1, end: 3 });
  });

  it('最多选择 8 文件/16 区间/每文件4区间，最新 readfile 优先于 rg', async () => {
    for (let i = 0; i < 12; i++)
      write(`f${i}.ts`, 'hit\nmiss\nhit\nmiss\nhit\nmiss\nhit\nmiss\nhit');
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    await workspace.execute({ op: 'rg', pattern: 'hit' });
    await workspace.execute({ op: 'readfile', path: 'f0.ts', start: 2, end: 2 });
    await workspace.execute({ op: 'readfile', path: 'f1.ts', start: 2, end: 2 });
    expect(typeof workspace.observedRanges).toBe('function');
    const ranges = workspace.observedRanges();
    expect(ranges[0]).toEqual({ path: '/codebase/f1.ts', start: 1, end: 3 });
    expect(ranges.length).toBeLessThanOrEqual(16);
    expect(new Set(ranges.map((r) => r.path)).size).toBeLessThanOrEqual(8);
    for (const path of new Set(ranges.map((r) => r.path))) {
      expect(ranges.filter((r) => r.path === path).length).toBeLessThanOrEqual(4);
    }
  });
});

describe('最终物理读取独立预算', () => {
  it('16 次 512KiB 最终物理读取恰好容纳于 8MiB，再读一次拒绝', async () => {
    write('a.ts', 'x'.repeat(LIMITS.fileBytes));
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    for (let i = 0; i < 16; i++) await workspace.snippet('/codebase/a.ts', 1, 1);
    await expect(workspace.snippet('/codebase/a.ts', 1, 1)).rejects.toMatchObject({
      code: 'bounds',
    });
  });

  it('扫描预算耗尽后仍重新读最终片段，不复用命令缓存', async () => {
    const saved = LIMITS.totalReadBytes;
    LIMITS.totalReadBytes = 32;
    try {
      write('a.ts', 'x'.repeat(31));
      const workspace = await LocalWorkspace.create(root, undefined, signal);
      await workspace.execute({ op: 'readfile', path: 'a.ts' });
      write('a.ts', 'latest content');
      const result = await workspace.snippet('/codebase/a.ts', 1, 1);
      expect(result.content).toBe('1: latest content');
    } finally {
      LIMITS.totalReadBytes = saved;
    }
  });

  it('最终读取仍严格拒绝越出文件长度的区间', async () => {
    write('a.ts', 'one');
    const workspace = await LocalWorkspace.create(root, undefined, signal);
    await expect(workspace.snippet('/codebase/a.ts', 1, 2)).rejects.toMatchObject({
      code: 'bounds',
    });
  });
});
