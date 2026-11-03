const NON_INTERACTIVE_ENV = {
  NO_COLOR: '1',
  FORCE_COLOR: '0',
  TERM: 'dumb',
  DEBIAN_FRONTEND: 'noninteractive',
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  // 本地工具有意禁止 askpass，即使调用方显式启用；不更改 SSH 命令或代理认证。
  GIT_ASKPASS: '',
  SSH_ASKPASS: '',
  SSH_ASKPASS_REQUIRE: 'never',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  MANPAGER: 'cat',
  LESS: 'FRX',
  GIT_EDITOR: 'false',
  GIT_SEQUENCE_EDITOR: 'false',
  PYTHONUNBUFFERED: '1',
  PYTHONIOENCODING: 'utf-8',
  npm_config_yes: 'true',
  // 非交互 bash 仍会读取 $BASH_ENV；也清除 $ENV，避免后代 shell 使用继承的 rc。
  BASH_ENV: '',
  ENV: '',
};

/** 仅覆盖非交互设置；保留 PATH、代理、凭据及用户的 Git SSH 命令。 */
export function hardenedEnv(
  base: NodeJS.ProcessEnv,
  {
    shell,
    platform = process.platform,
  }: { shell: 'bash' | 'powershell'; platform?: NodeJS.Platform }
): NodeJS.ProcessEnv {
  const overrides =
    shell === 'bash'
      ? { ...NON_INTERACTIVE_ENV, PS1: '', PROMPT_COMMAND: '' }
      : NON_INTERACTIVE_ENV;
  const env = { ...base };
  if (platform === 'win32') {
    // Windows env 不区分大小写；若保留别名，spawn 可能选中原值而非覆盖值。
    const keys = new Set(Object.keys(overrides).map((key) => key.toUpperCase()));
    for (const key of Object.keys(env)) if (keys.has(key.toUpperCase())) delete env[key];
  }
  return Object.assign(env, overrides);
}
