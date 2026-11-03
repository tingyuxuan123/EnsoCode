import { describe, expect, it } from 'vitest';
import { hardenedEnv } from './hardenedEnv';

describe('hardenedEnv', () => {
  it('覆盖启动 rc、提示符、分页器及其他需要非交互的默认项', () => {
    const env = hardenedEnv(
      { BASH_ENV: '/fixtures/bashrc', ENV: '/fixtures/shrc', PS1: '> ', PROMPT_COMMAND: 'prompt' },
      { shell: 'bash' }
    );
    expect(env).toMatchObject({
      BASH_ENV: '',
      ENV: '',
      PS1: '',
      PROMPT_COMMAND: '',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      TERM: 'dumb',
      DEBIAN_FRONTEND: 'noninteractive',
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      GIT_PAGER: 'cat',
      PAGER: 'cat',
      MANPAGER: 'cat',
      LESS: 'FRX',
      GIT_EDITOR: 'false',
      GIT_SEQUENCE_EDITOR: 'false',
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      npm_config_yes: 'true',
    });
    expect(env).not.toHaveProperty('CI');
    expect(env).not.toHaveProperty('GIT_SSH_COMMAND');
  });

  it('覆盖显式启用的交互式 askpass，但原样保留非交互认证、代理及 PATH，不改输入', () => {
    const inherited = {
      PATH: '/fixtures/bin',
      HTTP_PROXY: 'http://proxy.invalid:1234',
      HTTPS_PROXY: 'http://proxy.invalid:1234',
      NO_PROXY: 'localhost',
      PI_SESSION_ID: 'fixture-session',
      GH_TOKEN: 'fixture-token',
      SSH_AUTH_SOCK: '/fixtures/ssh-agent.sock',
      GIT_SSH: '/fixtures/ssh-wrapper',
      GIT_SSH_COMMAND: ' ssh -i /fixtures/deploy_key ',
    };
    const interactive = {
      GIT_ASKPASS: '/fixtures/git-askpass',
      SSH_ASKPASS: '/fixtures/ssh-askpass',
      SSH_ASKPASS_REQUIRE: 'force',
    };
    const base = Object.freeze({ ...inherited, ...interactive });
    expect(hardenedEnv(base, { shell: 'bash' })).toMatchObject({
      ...inherited,
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
      SSH_ASKPASS_REQUIRE: 'never',
    });
    expect(base).toEqual({ ...inherited, ...interactive });
  });

  it('PowerShell 清空 rc 变量但不注入 bash 提示符，保留空的用户 SSH 命令', () => {
    const base = { BASH_ENV: '/fixtures/bashrc', ENV: '/fixtures/shrc', GIT_SSH_COMMAND: '' };
    const env = hardenedEnv(base, { shell: 'powershell' });
    expect(env).toMatchObject({
      BASH_ENV: '',
      ENV: '',
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_COMMAND: '',
    });
    expect(env).not.toHaveProperty('PS1');
    expect(env).not.toHaveProperty('PROMPT_COMMAND');
  });

  it('win32 仅归一化受控键的大小写别名，避免 spawn 选中旧值', () => {
    const env = hardenedEnv(
      { Path: 'C:\\fixture', Bash_Env: 'C:\\fixture\\rc', NPM_CONFIG_YES: 'false' },
      { shell: 'powershell', platform: 'win32' }
    );
    expect(env).toMatchObject({ Path: 'C:\\fixture', BASH_ENV: '', npm_config_yes: 'true' });
    expect(env).not.toHaveProperty('Bash_Env');
    expect(env).not.toHaveProperty('NPM_CONFIG_YES');
  });
});
