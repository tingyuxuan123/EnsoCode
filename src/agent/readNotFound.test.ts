import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createReadToolDefinition } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalReadPathProbe, type ReadPathProbe, withReadNotFoundHint } from './readNotFound';

type Execute = (
  toolCallId: string,
  params: unknown,
  signal?: AbortSignal,
  onUpdate?: unknown,
  ctx?: unknown
) => Promise<unknown>;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'enso-read-hint-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function touch(relative: string, content = 'x'): Promise<void> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

function localRead(cwd = root): Execute {
  const definition = withReadNotFoundHint(createReadToolDefinition(cwd), {
    cwd,
    probe: createLocalReadPathProbe(),
  });
  return definition.execute as unknown as Execute;
}

async function failure(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the read to fail');
}

describe('withReadNotFoundHint（本地 read）', () => {
  it('目录存在、文件名猜错：仍然失败，首行给工作区相对路径并列出该目录条目', async () => {
    await touch('packages/relay/package.json', '{}');
    await touch('packages/relay/src/index.ts');
    const message = await failure(localRead()('c1', { path: 'packages/relay/wrangler.toml' }));
    const [first, ...rest] = message.split('\n');
    expect(first).toBe('File not found: packages/relay/wrangler.toml');
    const body = rest.join('\n');
    expect(body).toContain('packages/relay/');
    expect(body).toContain('package.json');
    expect(body).toContain('src/');
    expect(message).not.toContain(root);
  });

  it('整段目录猜错：指出最近存在的目录，并给出工作区里的同名文件', async () => {
    await touch('src/renderer/components/chat/chatHost.ts');
    await touch('src/main/index.ts');
    const message = await failure(localRead()('c1', { path: 'src/components/chat/chatHost.ts' }));
    expect(message.split('\n')[0]).toBe('File not found: src/components/chat/chatHost.ts');
    expect(message).toContain('Nearest existing directory src/;');
    expect(message).toContain('renderer/');
    expect(message).toContain('src/renderer/components/chat/chatHost.ts');
  });

  it('同名文件候选遵守 .gitignore', async () => {
    await touch('.gitignore', 'vendor/\n');
    await touch('vendor/lib/settings.ts');
    await touch('app/settings.ts');
    await touch('web/readme.md');
    const message = await failure(localRead()('c1', { path: 'web/settings.ts' }));
    expect(message).toContain('app/settings.ts');
    expect(message).not.toContain('vendor/lib/settings.ts');
  });

  it('大目录只列与缺失名最接近的条目，并说明省略数量', async () => {
    for (let i = 0; i < 60; i++) await touch(`big/file-${String(i).padStart(2, '0')}.ts`);
    await touch('big/settings.ts');
    const message = await failure(localRead()('c1', { path: 'big/setings.ts' }));
    expect(message).toContain('settings.ts');
    expect(message).toMatch(/\d+ more/);
    expect(message).not.toContain('file-59.ts, file-58.ts');
    expect(message.length).toBeLessThan(1500);
  });

  it('工作区外的路径用绝对路径显示，不在工作区里搜同名文件', async () => {
    const workspace = path.join(root, 'workspace');
    await touch('workspace/other/shot.png');
    await touch('outside/keep.txt');
    const target = path.join(root, 'outside', 'shot.png');
    const message = await failure(localRead(workspace)('c1', { path: target }));
    expect(message.split('\n')[0]).toBe(`File not found: ${target}`);
    expect(message).toContain('keep.txt');
    expect(message).not.toContain('other/shot.png');
  });

  it('提醒同一批里生成文件的调用可能尚未完成', async () => {
    await touch('tmp/.keep');
    const message = await failure(localRead()('c1', { path: 'tmp/screenshot.png' }));
    expect(message).toMatch(/same batch/i);
  });

  it('失败后文件已出现（并行竞态）：明确告诉模型重新读取', async () => {
    const target = path.join(root, 'late.txt');
    const racing = withReadNotFoundHint(
      {
        execute: async () => {
          const error = Object.assign(
            new Error(`ENOENT: no such file or directory, access '${target}'`),
            { code: 'ENOENT', path: target }
          );
          await writeFile(target, 'done');
          throw error;
        },
      },
      { cwd: root, probe: createLocalReadPathProbe() }
    );
    const message = await failure(
      (racing.execute as unknown as Execute)('c1', { path: 'late.txt' })
    );
    expect(message.split('\n')[0]).toBe('File not found: late.txt');
    expect(message).toMatch(/exists now/i);
  });

  it('不是“文件不存在”的错误原样透传', async () => {
    await touch('short.txt', 'a\nb\n');
    const message = await failure(localRead()('c1', { path: 'short.txt', offset: 50 }));
    expect(message).toMatch(/beyond end of file/);
    expect(message).not.toContain('File not found');
  });

  it('正常读取不受影响', async () => {
    await touch('ok.txt', 'hello');
    const result = (await localRead()('c1', { path: 'ok.txt' })) as {
      content: Array<{ type: string; text?: string }>;
    };
    expect(result.content[0]?.text).toContain('hello');
  });
});

describe('withReadNotFoundHint（探测异常与远程）', () => {
  const remoteNotReadable = (target: string) => ({
    execute: async () => {
      throw new Error(`${target} is not readable on remote host`);
    },
  });

  it('远程“不可读”但路径其实存在（权限问题）：原样透传', async () => {
    const probe: ReadPathProbe = {
      kind: async () => 'file',
      list: async () => [],
    };
    const definition = withReadNotFoundHint(remoteNotReadable('/srv/app/secret.txt'), {
      cwd: '/srv/app',
      probe,
      pathApi: path.posix,
    });
    const message = await failure(
      (definition.execute as unknown as Execute)('c1', { path: 'secret.txt' })
    );
    expect(message).toBe('/srv/app/secret.txt is not readable on remote host');
  });

  it('远程路径不存在：用 posix 相对路径给出最近目录', async () => {
    const probe: ReadPathProbe = {
      kind: async (target) => (target === '/srv/app' || target === '/srv/app/src' ? 'dir' : null),
      list: async (dir) => (dir === '/srv/app/src' ? ['main.py', 'util.py'] : []),
    };
    const definition = withReadNotFoundHint(remoteNotReadable('/srv/app/src/utils.py'), {
      cwd: '/srv/app',
      probe,
      pathApi: path.posix,
    });
    const message = await failure(
      (definition.execute as unknown as Execute)('c1', { path: 'src/utils.py' })
    );
    expect(message.split('\n')[0]).toBe('File not found: src/utils.py');
    expect(message).toContain('util.py');
  });

  it('探测卡住时按超时退回原始错误，不拖住工具调用', async () => {
    const original = `ENOENT: no such file or directory, access '${path.join(root, 'x.ts')}'`;
    const definition = withReadNotFoundHint(
      {
        execute: async () => {
          throw Object.assign(new Error(original), {
            code: 'ENOENT',
            path: path.join(root, 'x.ts'),
          });
        },
      },
      {
        cwd: root,
        probe: { kind: () => new Promise(() => {}), list: async () => [] },
        timeoutMs: 20,
      }
    );
    const started = Date.now();
    const message = await failure(
      (definition.execute as unknown as Execute)('c1', { path: 'x.ts' })
    );
    expect(message).toBe(original);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
