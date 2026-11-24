// Preloaded only for Git-backed diagnostics of the separately trusted CLI.
// This restricts its normal Node subprocess APIs, not arbitrary code or the OS.
const cp = require('node:child_process');
const { existsSync, writeSync } = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const { devNull } = require('node:os');
const { isAbsolute, resolve } = require('node:path');

const spawnSync = cp.spawnSync;
const root = process.env.LLMDOC_READ_ROOT ?? '';
const git = process.env.LLMDOC_READ_GIT ?? '';
const metadata = process.env.LLMDOC_READ_METADATA ?? '';
delete process.env.LLMDOC_READ_ROOT;
delete process.env.LLMDOC_READ_GIT;
delete process.env.LLMDOC_READ_METADATA;

/** @param {string} message @returns {never} */
function refuse(message) {
  // Upstream may catch a Git exception while constructing a successful JSON report.
  // A separate line on stderr lets the parent reject even in that case.
  writeSync(2, `LLMDOC_READ_GIT_ERROR: ${message}\n`);
  throw new Error(message);
}

if (
  !root ||
  !git ||
  !metadata ||
  ![root, git, metadata].every(isAbsolute) ||
  process.cwd() !== root
) {
  refuse('Git 只读配置不完整或不属于当前工作树。');
}

const env = {
  GIT_DIR: metadata,
  GIT_WORK_TREE: root,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_ATTR_NOSYSTEM: '1',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_NO_LAZY_FETCH: '1',
  GIT_ALLOW_PROTOCOL: '',
  GIT_TERMINAL_PROMPT: '0',
  LC_ALL: 'C',
  ...(process.platform === 'win32' && process.env.SystemRoot
    ? { SystemRoot: process.env.SystemRoot }
    : {}),
};
const gitOptions = [
  '--no-pager',
  '--no-optional-locks',
  '-c',
  'core.fsmonitor=false',
  '-c',
  `core.hooksPath=${devNull}`,
  '-c',
  `core.attributesFile=${devNull}`,
  '-c',
  `core.excludesFile=${devNull}`,
  '-c',
  'submodule.recurse=false',
  '-c',
  'gc.auto=0',
  '-c',
  'maintenance.auto=false',
];

/** @param {string[]} args */
function runPinned(args) {
  const result = spawnSync(git, [...gitOptions, ...args], {
    cwd: root,
    env,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 1_500,
    killSignal: 'SIGKILL',
    maxBuffer: 256 * 1024,
  });
  if (result.error || result.signal || result.status === null) {
    const code = result.error && 'code' in result.error ? result.error.code : undefined;
    refuse(`Git ${args[0]} 未完成（${code ?? result.signal ?? '无退出状态'}）。`);
  }
  return result;
}

/** @param {'--local' | '--worktree'} scope */
function auditConfig(scope) {
  const config = runPinned(['config', scope, '--no-includes', '--null', '--list']);
  if (config.status !== 0) refuse('Git 仓库配置无法读取。');
  for (const record of config.stdout.split('\0')) {
    const key = record.split('\n', 1)[0].toLowerCase();
    if (key === 'include.path' || key.startsWith('includeif.')) {
      refuse('Git 仓库含 include/includeIf 配置；无法保证只读调用不加载外部配置。');
    }
    if (/^filter\..*\.(?:clean|process|required)$/.test(key)) {
      // Even a name-only worktree diff can consult a clean/process filter.
      refuse('Git 仓库含 clean/process filter 配置；不会运行可能触发过滤器的诊断。');
    }
    if (key === 'extensions.partialclone' || /^remote\..+\.promisor$/.test(key)) {
      refuse('Git 仓库含 partial clone/promisor 配置；只读诊断不会尝试延迟获取对象。');
    }
  }
}

auditConfig('--local');
if (existsSync(resolve(metadata, 'config.worktree'))) auditConfig('--worktree');
const workspace = runPinned(['rev-parse', '--is-inside-work-tree']);
if (workspace.status !== 0 || workspace.stdout.trim() !== 'true')
  refuse('当前目录不是可读的 Git 工作树。');

// Exact forms from @tokenroll/llmdoc@3.6.0 dist/lib/git.js. Ref/range values
// from meta.json may be repository data: accept full hexadecimal object IDs only.
const SHA = '(?:[0-9a-f]{40}|[0-9a-f]{64})';
const objectId = new RegExp(`^${SHA}$`, 'i');
const range = new RegExp(`^${SHA}\\.\\.${SHA}$`, 'i');
const commit = new RegExp(`^${SHA}\\^\\{commit\\}$`, 'i');
const quoteConfig = ['-c', 'core.quotePath=false'];
const fixed = new Set(
  [
    ['rev-parse', '--verify', 'HEAD'],
    ['rev-parse', '--git-dir'],
    ['rev-parse', '--is-shallow-repository'],
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    ['symbolic-ref', '--quiet', 'HEAD'],
    ['diff', '--name-only', '--no-renames'],
    ['diff', '--name-only', '--no-renames', '--cached'],
    ['ls-files', '--others', '--exclude-standard'],
  ].map((args) => JSON.stringify(args))
);

/** @param {string[]} argv */
function audited(argv) {
  if (argv.length === 2 && argv[0] === 'rev-parse' && argv[1] === '--is-inside-work-tree')
    return true;
  if (argv.length === 3 && argv[0] === 'cat-file' && argv[1] === '-e' && commit.test(argv[2]))
    return true;
  if (argv[0] !== quoteConfig[0] || argv[1] !== quoteConfig[1]) return false;
  const args = argv.slice(2);
  if (fixed.has(JSON.stringify(args))) return true;
  if (!range.test(args.at(-1) ?? '')) return false;
  return (
    (args.length === 4 &&
      args[0] === 'diff' &&
      args[1] === '--name-only' &&
      args[2] === '--no-renames') ||
    (args.length === 3 && args[0] === 'rev-list' && args[1] === '--count') ||
    (args.length === 5 &&
      args[0] === 'log' &&
      args[1] === '--format=%x01%H' &&
      args[2] === '--name-only' &&
      args[3] === '--no-renames')
  );
}

// Explicitly disable config-driven output and filesystem helpers relevant to
// these forms. Ignore only dirty nested worktrees, not recorded gitlink changes.
/** @param {string[]} argv */
function constrained(argv) {
  const index = argv[0] === '-c' ? 2 : 0;
  const command = argv[index];
  const flags =
    command === 'diff' || command === 'log'
      ? ['--no-ext-diff', '--no-textconv', '--no-color', '--ignore-submodules=dirty']
      : [];
  if (command === 'log') flags.push('--no-show-signature', '--no-decorate');
  return [...argv.slice(0, index + 1), ...flags, ...argv.slice(index + 1)];
}

/** @param {import('node:child_process').SpawnSyncReturns<string>} result @param {string[]} args */
function checked(result, args) {
  const [command, flag, parameter] = args;
  const output = result.stdout.trim();
  const err = result.stderr.trim();
  if (result.status === 0) {
    if (command === 'rev-parse') {
      if (flag === '--is-inside-work-tree' && output !== 'true') refuse('Git 工作树不可读。');
      if (flag === '--git-dir' && (!output || resolve(root, output) !== metadata))
        refuse('Git 返回了非预期的元数据目录。');
      if (flag === '--is-shallow-repository' && !['true', 'false'].includes(output))
        refuse('Git 未返回有效的浅克隆状态。');
      if (
        flag === '--verify' &&
        (!objectId.test(output) || runPinned(['cat-file', '-e', `${output}^{commit}`]).status !== 0)
      ) {
        refuse('Git HEAD 未指向可读的提交对象。');
      }
    }
    return result;
  }
  // These negatives are meaningful inputs to upstream freshness/validation.
  // Never treat an arbitrary failure, timeout or config error as an empty diff.
  if (command === 'symbolic-ref' && result.status === 1 && !output && !err) return result;
  if (
    command === 'rev-parse' &&
    flag === '--verify' &&
    result.status === 128 &&
    err === 'fatal: Needed a single revision'
  )
    return result;
  if (
    command === 'cat-file' &&
    result.status === 128 &&
    err === `fatal: Not a valid object name ${parameter}`
  )
    return result;
  const detail = err
    .split('\n', 1)[0]
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .slice(0, 180);
  refuse(`Git ${command} 退出失败（${result.status}）。${detail}`);
}

/** @param {unknown} file @param {unknown} argv @param {unknown} options */
function guardedSpawnSync(file, argv, options) {
  if (
    file !== 'git' ||
    !Array.isArray(argv) ||
    !argv.every((arg) => typeof arg === 'string') ||
    options === null ||
    typeof options !== 'object' ||
    !('cwd' in options) ||
    options.cwd !== root ||
    !('encoding' in options) ||
    options.encoding !== 'utf8' ||
    Object.keys(options).length !== 2 ||
    !audited(argv)
  ) {
    refuse('拒绝不在白名单内的 Git 子进程请求。');
  }
  return checked(runPinned(constrained(argv)), argv[0] === '-c' ? argv.slice(2) : argv);
}

Object.assign(cp, { spawnSync: guardedSpawnSync });
for (const name of ['spawn', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  Object.assign(cp, { [name]: () => refuse('拒绝未授权的子进程 API。') });
}
Object.assign(cp.ChildProcess.prototype, { spawn: () => refuse('拒绝直接创建子进程。') });
syncBuiltinESMExports();
