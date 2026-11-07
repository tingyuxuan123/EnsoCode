import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createLocalBashOperations,
  createPowerShellToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionCommandTool, resolveSessionShellKind } from './sessionShell';

afterEach(() => vi.unstubAllEnvs());

describe('resolveSessionShellKind', () => {
  it('远程会话即便在 win32 上也选 bash', () => {
    expect(resolveSessionShellKind({ platform: 'win32', remote: true })).toBe('bash');
  });

  it('本地 win32 选 powershell', () => {
    expect(resolveSessionShellKind({ platform: 'win32' })).toBe('powershell');
  });

  it('本地非 win32(如 darwin)选 bash', () => {
    expect(resolveSessionShellKind({ platform: 'darwin' })).toBe('bash');
  });

  it('本地 win32 偏好 bash 时选 bash', () => {
    expect(resolveSessionShellKind({ platform: 'win32', preference: 'bash' })).toBe('bash');
  });

  it('本地 win32 偏好 powershell 或 auto 时选 powershell', () => {
    expect(resolveSessionShellKind({ platform: 'win32', preference: 'auto' })).toBe('powershell');
    expect(resolveSessionShellKind({ platform: 'win32', preference: 'powershell' })).toBe(
      'powershell'
    );
  });

  it('远程忽略偏好,仍选 bash', () => {
    expect(
      resolveSessionShellKind({ platform: 'win32', remote: true, preference: 'powershell' })
    ).toBe('bash');
  });

  it('非 win32 强制 powershell 也不生效', () => {
    expect(resolveSessionShellKind({ platform: 'darwin', preference: 'powershell' })).toBe('bash');
  });

  it('远程且非 win32 也选 bash', () => {
    expect(resolveSessionShellKind({ platform: 'linux', remote: true })).toBe('bash');
  });
});

describe('createSessionCommandTool', () => {
  it('本地 win32 建出的工具名为 powershell', () => {
    const tool = createSessionCommandTool({ cwd: '/tmp', platform: 'win32' });
    expect(tool.name).toBe('powershell');
  });

  it('本地 win32 偏好 bash 时建出 bash', () => {
    const tool = createSessionCommandTool({
      cwd: '/tmp',
      platform: 'win32',
      preference: 'bash',
    });
    expect(tool.name).toBe('bash');
  });

  it('远程 win32 建出的工具名仍为 bash', () => {
    const tool = createSessionCommandTool({ cwd: '/tmp', platform: 'win32', remote: true });
    expect(tool.name).toBe('bash');
  });

  it('本地 darwin 建出的工具名为 bash', () => {
    const tool = createSessionCommandTool({ cwd: '/tmp', platform: 'darwin' });
    expect(tool.name).toBe('bash');
  });

  it('不传 platform 时按 process.platform 判断', () => {
    const tool = createSessionCommandTool({ cwd: '/tmp' });
    expect(tool.name).toBe(process.platform === 'win32' ? 'powershell' : 'bash');
  });

  describe('PowerShell 版本提示', () => {
    const resolved = (shell: string) => () => ({ shell, args: ['-NoProfile', '-Command'] });

    it('解析到 pwsh 时告诉模型是 PowerShell 7+', () => {
      const tool = createSessionCommandTool({
        cwd: '/tmp',
        platform: 'win32',
        resolvePowerShell: resolved('C:\\Program Files\\PowerShell\\7\\pwsh.exe'),
      });
      expect(tool.description).toContain('PowerShell 7+');
      expect(tool.description).not.toContain('5.1');
    });

    it('回落到 Windows PowerShell 时告诉模型是 5.1 及其不支持的写法', () => {
      const tool = createSessionCommandTool({
        cwd: '/tmp',
        platform: 'win32',
        resolvePowerShell: resolved(
          'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
        ),
      });
      expect(tool.description).toContain('Windows PowerShell 5.1');
      expect(tool.description).toContain('&&');
      expect(tool.description).toContain('UTF-16');
    });

    it('按文件名识别 pwsh，不区分大小写', () => {
      const tool = createSessionCommandTool({
        cwd: '/tmp',
        platform: 'win32',
        resolvePowerShell: resolved('D:\\Tools\\PWSH.EXE'),
      });
      expect(tool.description).toContain('PowerShell 7+');
    });

    it('找不到 PowerShell 时保留原描述，不在建工具时抛错', () => {
      const tool = createSessionCommandTool({
        cwd: '/tmp',
        platform: 'win32',
        resolvePowerShell: () => {
          throw new Error('No PowerShell executable found');
        },
      });
      expect(tool.name).toBe('powershell');
      expect(tool.description).toBe(createPowerShellToolDefinition('/tmp').description);
    });

    it('bash 会话不探测 PowerShell', () => {
      const resolvePowerShell = vi.fn(resolved('pwsh.exe'));
      createSessionCommandTool({
        cwd: '/tmp',
        platform: 'win32',
        preference: 'bash',
        resolvePowerShell,
      });
      createSessionCommandTool({ cwd: '/tmp', platform: 'win32', remote: true, resolvePowerShell });
      createSessionCommandTool({ cwd: '/tmp', platform: 'darwin', resolvePowerShell });
      expect(resolvePowerShell).not.toHaveBeenCalled();
    });
  });

  it.skipIf(process.platform === 'win32')('本地前台 bash 不执行继承的启动 rc', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'enso-fg-env-'));
    const rc = path.join(cwd, 'startup.sh');
    const sentinel = path.join(cwd, 'rc-ran');
    try {
      writeFileSync(rc, ': > ./rc-ran\n');
      // 阳性对照：旧的 pi 本地 operations 确实会 source 这份临时 rc。
      await createLocalBashOperations().exec('true', cwd, {
        onData: () => {},
        env: { BASH_ENV: rc, ENV: rc, HOME: cwd, PATH: '/usr/bin:/bin' },
      });
      expect(existsSync(sentinel)).toBe(true);
      rmSync(sentinel);
      vi.stubEnv('BASH_ENV', rc);
      vi.stubEnv('ENV', rc);
      const tool = createSessionCommandTool({ cwd });
      await tool.execute('fg', { command: 'true' }, undefined, undefined, undefined as never);
      expect(existsSync(sentinel)).toBe(false);
      expect(process.env.BASH_ENV).toBe(rc);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    '前台非交互 env 保留 pi 注入的会话信息和 PATH',
    async () => {
      const cwd = process.cwd();
      const tool = createSessionCommandTool({ cwd });
      const ctx = {
        cwd,
        sessionManager: { getSessionId: () => 'fixture-session', getSessionFile: () => undefined },
      } as Parameters<typeof tool.execute>[4];
      vi.stubEnv('BASH_ENV', undefined);
      vi.stubEnv('ENV', undefined);
      vi.stubEnv('PATH', '/opt/enso-fixture/bin:/usr/bin:/bin');
      vi.stubEnv('GIT_TERMINAL_PROMPT', '1');
      vi.stubEnv('PAGER', 'less');
      vi.stubEnv('NO_COLOR', '0');
      const result = await tool.execute(
        'fg',
        {
          command:
            'printf "%s|%s|%s|%s" "$GIT_TERMINAL_PROMPT" "$PAGER" "$NO_COLOR" "$PI_SESSION_ID"; ' +
            'case ":$PATH:" in *:/opt/enso-fixture/bin:*) printf "|path-ok";; esac',
        },
        undefined,
        undefined,
        ctx
      );
      expect(result.content).toEqual([{ type: 'text', text: '0|cat|1|fixture-session|path-ok' }]);
    }
  );

  it('远程 operations 保留自身 askpass 策略', async () => {
    vi.stubEnv('SSH_ASKPASS_REQUIRE', 'force');
    let askpass: string | undefined;
    const tool = createSessionCommandTool({
      cwd: '/srv/app',
      remote: true,
      operations: {
        async exec(_command, _cwd, options) {
          askpass = options.env?.SSH_ASKPASS_REQUIRE;
          return { exitCode: 0 };
        },
      },
    });
    await tool.execute('remote', { command: 'true' }, undefined, undefined, undefined as never);
    expect(askpass).toBe('force');
  });
});
