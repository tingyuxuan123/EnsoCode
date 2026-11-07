import * as fs from 'node:fs';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// App identities come from the macOS backend, while allowlist files live on the test host.
// Keep native join/dirname for the real temporary files; only identity validation is POSIX.
vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  return {
    ...actual,
    default: {
      ...actual,
      isAbsolute: actual.posix.isAbsolute,
      normalize: actual.posix.normalize,
    },
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    renameSync: vi.fn(actual.renameSync),
  };
});

import {
  AppAuthorizer,
  type AppPromptAnswer,
  appIdentityKey,
  normalizeAppIdentity,
  readAllowedApps,
} from './appAuthorization';

const textEdit = {
  bundleId: 'com.apple.TextEdit',
  name: 'TextEdit',
  path: '/System/Applications/TextEdit.app',
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDirectory(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'enso-apps-'));
  tempDirs.push(dir);
  return dir;
}

function tempFile(): string {
  return path.join(tempDirectory(), 'apps.json');
}

function authorizer(file: string, answers: AppPromptAnswer[]) {
  const prompts: string[] = [];
  const auth = new AppAuthorizer({
    file,
    prompt: async (app) => {
      prompts.push(app.name);
      return answers.shift() ?? 'deny';
    },
    now: () => 1000,
  });
  return { auth, prompts };
}

describe('normalizeAppIdentity', () => {
  it('接受规范 .app 绝对路径与反向域名 bundle id', () => {
    expect(normalizeAppIdentity(textEdit)).toEqual(textEdit);
  });

  it('拒绝相对路径、.. 片段、非规范路径和脏 bundle id', () => {
    expect(normalizeAppIdentity({ ...textEdit, path: 'Applications/TextEdit.app' })).toBeNull();
    expect(normalizeAppIdentity({ ...textEdit, path: '/Applications/../tmp/x.app' })).toBeNull();
    expect(normalizeAppIdentity({ ...textEdit, path: '/Applications//TextEdit.app' })).toBeNull();
    expect(normalizeAppIdentity({ ...textEdit, bundleId: 'bad id;rm' })).toBeNull();
    expect(normalizeAppIdentity(null)).toBeNull();
    expect(normalizeAppIdentity('TextEdit')).toBeNull();
  });

  it('macOS app 身份不把 Windows 盘符路径当作绝对路径', () => {
    expect(
      normalizeAppIdentity({ ...textEdit, path: 'C:\\Applications\\TextEdit.app' })
    ).toBeNull();
  });

  it('不在 .app 里的窗口程序以可执行文件路径作身份（不能因此跳过授权）', () => {
    const tool = { bundleId: '', name: 'python3', path: '/opt/homebrew/bin/python3' };
    expect(normalizeAppIdentity(tool)).toEqual(tool);
    expect(appIdentityKey(tool)).toBe(JSON.stringify(['', tool.path]));
  });

  it('没有 bundle id 时允许空串，以路径作身份', () => {
    const bare = { bundleId: '', name: 'Tool', path: '/Applications/Tool.app' };
    expect(normalizeAppIdentity(bare)).toEqual(bare);
    expect(appIdentityKey(bare)).toBe(JSON.stringify(['', bare.path]));
    expect(appIdentityKey(textEdit)).not.toBe(
      appIdentityKey({ ...textEdit, path: '/Other/TextEdit.app' })
    );
  });
});

describe('readAllowedApps', () => {
  it('a directory, unsupported schema version or malformed fields never grant access', () => {
    const file = tempFile();
    expect(readAllowedApps(path.dirname(file))).toEqual([]);
    writeFileSync(file, JSON.stringify({ version: 2, apps: [{ ...textEdit, grantedAt: 1 }] }));
    expect(readAllowedApps(file)).toEqual([]);
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        apps: [
          { ...textEdit, path: '/', grantedAt: 1 },
          { ...textEdit, path: '/tmp/evil\n.app', grantedAt: 1 },
        ],
      })
    );
    expect(readAllowedApps(file)).toEqual([]);
  });
  it('文件不存在或损坏返回空表，脏条目丢弃', () => {
    const file = tempFile();
    expect(readAllowedApps(file)).toEqual([]);
    writeFileSync(file, '{oops');
    expect(readAllowedApps(file)).toEqual([]);
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        apps: [{ ...textEdit, grantedAt: 5 }, { bundleId: 'x y', path: 'rel', name: 1 }, 'junk'],
      })
    );
    expect(readAllowedApps(file)).toEqual([{ ...textEdit, grantedAt: 5 }]);
  });
});

describe('AppAuthorizer', () => {
  it('unchanged allowlist checks use memory, and revoke denies the next check', async () => {
    const file = tempFile();
    const { auth } = authorizer(file, ['always']);
    await auth.authorize('s1', textEdit);
    const read = vi.spyOn(fs, 'readFileSync').mockClear();
    try {
      for (let i = 0; i < 20; i++) expect(auth.isAuthorized('s1', textEdit)).toBe(true);
      expect(read).not.toHaveBeenCalled();
      auth.revoke(appIdentityKey(textEdit));
      expect(auth.isAuthorized('s1', textEdit)).toBe(false);
    } finally {
      read.mockRestore();
    }
  });

  it('failed revoke leaves disk and session grants unchanged', async () => {
    const file = tempFile();
    const { auth } = authorizer(file, ['once', 'always']);
    await auth.authorize('s1', textEdit);
    await auth.authorize('s2', textEdit);
    const before = readFileSync(file, 'utf8');
    const write = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('disk full');
    });
    try {
      expect(() => auth.revoke(appIdentityKey(textEdit))).toThrow('disk full');
      expect(readFileSync(file, 'utf8')).toBe(before);
      expect(auth.list()).toEqual(readAllowedApps(file));
      expect(auth.isAuthorized('s2', textEdit)).toBe(true);
      // Remove the persistent entry externally: the original session grant must survive too.
      writeFileSync(file, JSON.stringify({ version: 1, apps: [] }));
      expect(auth.isAuthorized('s1', textEdit)).toBe(true);
    } finally {
      write.mockRestore();
    }
  });
  it('an externally edited/revoked allowlist is reread, not cached as permission', async () => {
    const file = tempFile();
    const { auth, prompts } = authorizer(file, ['always', 'deny']);
    await auth.authorize('s1', textEdit);
    writeFileSync(file, JSON.stringify({ version: 1, apps: [] }));
    await expect(auth.authorize('s1', textEdit)).rejects.toMatchObject({ code: 'app-denied' });
    expect(prompts).toHaveLength(2);
  });
  it('aborted calls cannot reuse existing grants or store a late approval', async () => {
    const controller = new AbortController();
    const answer = Promise.withResolvers<AppPromptAnswer>();
    const prompted = Promise.withResolvers<'prompt-open'>();
    const auth = new AppAuthorizer({
      file: tempFile(),
      prompt: () => {
        prompted.resolve('prompt-open');
        return answer.promise;
      },
    });
    const pending = auth.authorize('s1', textEdit, controller.signal);
    await expect(Promise.race([prompted.promise, pending])).resolves.toBe('prompt-open');
    controller.abort();
    answer.resolve('always');
    await expect(pending).rejects.toMatchObject({ code: 'app-prompt-dismissed' });
    expect(auth.list()).toEqual([]);
    await expect(auth.authorize('s1', textEdit, controller.signal)).rejects.toThrow();
  });

  it('prompt timeout is bounded even if its implementation ignores abort', async () => {
    const auth = new AppAuthorizer({
      file: tempFile(),
      promptTimeoutMs: 5,
      prompt: () => new Promise(() => {}),
    });
    await expect(auth.authorize('s1', textEdit)).rejects.toMatchObject({
      code: 'app-prompt-dismissed',
    });
  });

  it('revoking while a prompt is open cannot resurrect a grant', async () => {
    const answer = Promise.withResolvers<AppPromptAnswer>();
    const prompted = Promise.withResolvers<'prompt-open'>();
    const auth = new AppAuthorizer({
      file: tempFile(),
      prompt: () => {
        prompted.resolve('prompt-open');
        return answer.promise;
      },
    });
    const pending = auth.authorize('s1', textEdit);
    await expect(Promise.race([prompted.promise, pending])).resolves.toBe('prompt-open');
    auth.revoke(appIdentityKey(textEdit));
    answer.resolve('always');
    await expect(pending).rejects.toMatchObject({ code: 'app-prompt-dismissed' });
    expect(auth.list()).toEqual([]);
  });

  it('始终允许：写入名单，之后不再询问（跨 session）', async () => {
    const file = tempFile();
    const { auth, prompts } = authorizer(file, ['always']);
    await auth.authorize('s1', textEdit);
    await auth.authorize('s2', textEdit);
    expect(prompts).toEqual(['TextEdit']);
    expect(readAllowedApps(file)).toEqual([{ ...textEdit, grantedAt: 1000, lastUsedAt: 1000 }]);
  });

  it('名单只落身份元数据，不带 pid 等运行期字段', async () => {
    const file = tempFile();
    const { auth } = authorizer(file, ['always']);
    await auth.authorize('s1', { ...textEdit, pid: 42 } as typeof textEdit);
    expect(JSON.parse(readFileSync(file, 'utf8')).apps).toEqual([
      { ...textEdit, grantedAt: 1000, lastUsedAt: 1000 },
    ]);
  });

  it('仅本次：同 session 不再问，别的 session 再问，不落盘', async () => {
    const file = tempFile();
    const { auth, prompts } = authorizer(file, ['once', 'once']);
    await auth.authorize('s1', textEdit);
    await auth.authorize('s1', textEdit);
    await auth.authorize('s2', textEdit);
    expect(prompts).toEqual(['TextEdit', 'TextEdit']);
    expect(readAllowedApps(file)).toEqual([]);
  });

  it('拒绝：本 session 记住拒绝，直接报 app-denied 不重复弹窗', async () => {
    const { auth, prompts } = authorizer(tempFile(), ['deny']);
    await expect(auth.authorize('s1', textEdit)).rejects.toMatchObject({ code: 'app-denied' });
    await expect(auth.authorize('s1', textEdit)).rejects.toMatchObject({ code: 'app-denied' });
    expect(prompts).toEqual(['TextEdit']);
    auth.forgetSession('s1');
    await expect(auth.authorize('s1', textEdit)).rejects.toMatchObject({ code: 'app-denied' });
    expect(prompts).toEqual(['TextEdit', 'TextEdit']);
  });

  it('同 app 并发申请只弹一次窗', async () => {
    const { auth, prompts } = authorizer(tempFile(), ['once']);
    await Promise.all([auth.authorize('s1', textEdit), auth.authorize('s1', textEdit)]);
    expect(prompts).toEqual(['TextEdit']);
  });

  it('同 bundle id 换了路径（被替换的 app）重新询问', async () => {
    const file = tempFile();
    const { auth, prompts } = authorizer(file, ['always', 'deny']);
    await auth.authorize('s1', textEdit);
    await expect(
      auth.authorize('s1', { ...textEdit, path: '/Users/x/Downloads/TextEdit.app' })
    ).rejects.toMatchObject({ code: 'app-denied' });
    expect(prompts).toHaveLength(2);
  });

  it('撤销后再次询问；名单可列出', async () => {
    const file = tempFile();
    const { auth, prompts } = authorizer(file, ['always', 'once']);
    await auth.authorize('s1', textEdit);
    expect(auth.list().map((app) => app.bundleId)).toEqual(['com.apple.TextEdit']);
    expect(auth.revoke(appIdentityKey(textEdit))).toBe(true);
    expect(auth.revoke(appIdentityKey(textEdit))).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8')).apps).toEqual([]);
    await auth.authorize('s2', textEdit);
    expect(prompts).toHaveLength(2);
  });

  it('撤销也清掉各 session 的「仅本次」授权', async () => {
    const { auth, prompts } = authorizer(tempFile(), ['once', 'deny']);
    await auth.authorize('s1', textEdit);
    auth.revoke(appIdentityKey(textEdit));
    await expect(auth.authorize('s1', textEdit)).rejects.toMatchObject({ code: 'app-denied' });
    expect(prompts).toHaveLength(2);
  });

  it('超时未答或 run 中止：报 app-prompt-dismissed，不记为拒绝，下次仍询问', async () => {
    const seen: AbortSignal[] = [];
    let calls = 0;
    const auth = new AppAuthorizer({
      file: tempFile(),
      promptTimeoutMs: 20,
      prompt: (_app, signal) => {
        seen.push(signal);
        calls += 1;
        if (calls > 1) return Promise.resolve('once');
        return new Promise((resolve) =>
          signal.addEventListener('abort', () => resolve('deny'), { once: true })
        );
      },
    });
    await expect(auth.authorize('s1', textEdit)).rejects.toMatchObject({
      code: 'app-prompt-dismissed',
    });
    expect(seen[0]?.aborted).toBe(true);
    await expect(auth.authorize('s1', textEdit)).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it('调用方中止时关闭提示', async () => {
    const controller = new AbortController();
    const auth = new AppAuthorizer({
      file: tempFile(),
      prompt: (_app, signal) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () => resolve('dismissed'), { once: true })
        ),
    });
    const pending = auth.authorize('s1', textEdit, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'app-prompt-dismissed' });
  });

  it('始终允许但名单写盘失败：本次 session 仍放行，不让动作失败', async () => {
    const dir = tempDirectory();
    const blocker = path.join(dir, 'not-a-dir');
    writeFileSync(blocker, 'x');
    const { auth, prompts } = authorizer(path.join(blocker, 'apps.json'), ['always']);
    await expect(auth.authorize('s1', textEdit)).resolves.toBeUndefined();
    await expect(auth.authorize('s1', textEdit)).resolves.toBeUndefined();
    expect(prompts).toEqual(['TextEdit']);
  });

  it('提示框异常按拒绝处理', async () => {
    const auth = new AppAuthorizer({
      file: tempFile(),
      prompt: async () => {
        throw new Error('no ui');
      },
    });
    await expect(auth.authorize('s1', textEdit)).rejects.toMatchObject({ code: 'app-denied' });
  });
});
