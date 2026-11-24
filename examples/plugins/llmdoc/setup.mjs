import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, relative, sep } from 'node:path';

const WINDOWS = process.platform === 'win32';
const NODE_NAME = WINDOWS ? 'node.exe' : 'node';
const GIT_NAME = WINDOWS ? 'git.exe' : 'git';
const REGISTRY = 'https://registry.npmjs.org/';
const PINNED_VERSION = '3.6.0';
const PROBE_LIMIT = 5;
const OUTPUT_LIMIT = 128 * 1024;
const NODE_PROBE =
  'JSON.stringify({node:process.versions.node,release:process.release.name,electron:process.versions.electron??null})';
/** @type {Set<string>} */
const liveInstalls = new Set();

/** @typedef {Record<string, unknown>} Config */
/** @typedef {{cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, signal?: AbortSignal}} RunOptions */
/** @typedef {(file: string, argv: string[], options: RunOptions) => Promise<{code: number, stdout: string, stderr: string}>} Run */

/** @param {unknown} path @returns {path is string} */
function localPath(path) {
  return (
    typeof path === 'string' &&
    path.length <= 4096 &&
    isAbsolute(path) &&
    !/[\p{Cc}\p{Cf}*]/u.test(path) &&
    (!WINDOWS || /^[A-Za-z]:[/\\][^:]*$/.test(path))
  );
}

/** @param {string} root @param {string} path */
function outside(root, path) {
  const rel = relative(root, path);
  return isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`);
}

/** @param {string} path */
async function exists(path) {
  return lstat(path).catch(() => null);
}

/** @param {unknown} value @returns {value is Config} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {Config} config @param {string} field */
function explicit(config, field) {
  return (
    Object.hasOwn(config, field) &&
    config[field] !== undefined &&
    config[field] !== null &&
    config[field] !== ''
  );
}

/** @param {unknown} path @param {string} root */
async function externalPath(path, root) {
  if (!localPath(path) || !outside(root, path)) return null;
  const canonical = await realpath(path).catch(() => null);
  return localPath(canonical) && outside(root, canonical) ? canonical : null;
}

/** @param {string} file */
async function nativeBinary(file) {
  if (!(await exists(file))?.isFile()) return false;
  try {
    await access(file, constants.X_OK);
    const handle = await open(file, 'r');
    try {
      const bytes = Buffer.alloc(4);
      if ((await handle.read(bytes)).bytesRead !== bytes.length) return false;
      if (WINDOWS) return bytes[0] === 0x4d && bytes[1] === 0x5a;
      return [
        '7f454c46',
        'feedface',
        'feedfacf',
        'cefaedfe',
        'cffaedfe',
        'cafebabe',
        'cafebabf',
        'bebafeca',
        'bfbafeca',
      ].includes(bytes.toString('hex'));
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

/** @param {NodeJS.ProcessEnv} env */
function systemBins(env) {
  if (process.platform === 'darwin')
    return ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin', '/bin'];
  if (!WINDOWS) return ['/usr/local/bin', '/usr/bin', '/bin'];
  const drive = parse(localPath(env.SystemRoot) ? env.SystemRoot : 'C:\\Windows').root;
  const programs = [join(drive, 'Program Files'), join(drive, 'Program Files (x86)')];
  if (localPath(env.LOCALAPPDATA)) programs.push(join(env.LOCALAPPDATA, 'Programs'));
  return programs.flatMap((dir) => [
    join(dir, 'nodejs'),
    join(dir, 'Git', 'cmd'),
    join(dir, 'Git', 'bin'),
  ]);
}

/** @param {string} home @param {string} root */
async function nodeManagerBins(home, root) {
  if (!localPath(home)) return [];
  /** @type {[string, string[]][]} */
  const managers = [
    [join(home, '.nvm', 'versions', 'node'), ['bin']],
    [join(home, '.volta', 'tools', 'image', 'node'), WINDOWS ? [] : ['bin']],
    [join(home, '.local', 'share', 'mise', 'installs', 'node'), ['bin']],
    [join(home, '.asdf', 'installs', 'nodejs'), ['bin']],
    [join(home, '.local', 'share', 'fnm', 'node-versions'), ['installation', 'bin']],
  ];
  if (WINDOWS) managers.push([join(home, 'AppData', 'Roaming', 'nvm'), []]);
  const results = [];
  for (const [dir, segments] of managers) {
    const base = await externalPath(dir, root);
    if (!base || !(await exists(base))?.isDirectory()) continue;
    const versions = [];
    let count = 0;
    try {
      for await (const entry of await opendir(base)) {
        if (++count > 128) break;
        if (entry.isDirectory() && /^v?\d{1,3}\.\d{1,4}\.\d{1,5}$/.test(entry.name))
          versions.push(entry.name);
      }
    } catch {
      // An unavailable optional version-manager directory must not block discovery.
      continue;
    }
    versions.sort((left, right) => right.localeCompare(left, 'en', { numeric: true }));
    for (const v of versions.slice(0, 8)) results.push(join(base, v, ...segments));
  }
  return results;
}

/** @param {string} bin */
const prefixFromBin = (bin) => (basename(bin).toLowerCase() === 'bin' ? dirname(bin) : bin);
/** @param {string} prefix */
const cliEntry = (prefix) =>
  join(prefix, 'node_modules', '@tokenroll', 'llmdoc', 'dist', 'bin', 'llmdoc.js');

/** @param {NodeJS.ProcessEnv} env @param {string} root */
function windowsEnvironment(env, root) {
  return WINDOWS && localPath(env.SystemRoot) && outside(root, env.SystemRoot)
    ? { SystemRoot: env.SystemRoot }
    : {};
}

/** @param {AbortSignal | undefined} signal */
function checkCancelled(signal) {
  if (signal?.aborted) throw new Error('llmdoc 安装已取消。');
}

/** @type {Run} */
function runProcess(file, argv, { cwd, env, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    checkCancelled(signal);
    const child = spawn(file, argv, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    /** @type {Buffer[]} */
    const stdout = [];
    /** @type {Buffer[]} */
    const stderr = [];
    let size = 0;
    /** @type {Error | null} */
    let failure = null;
    /** @param {Error} error */
    const stop = (error) => {
      if (failure) return;
      failure = error;
      child.kill('SIGKILL');
    };
    const abort = () => stop(new Error('llmdoc 安装已取消。'));
    const timer = setTimeout(() => stop(new Error('llmdoc 运行时子进程超时。')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    /** @param {Buffer[]} destination @param {Buffer} chunk */
    const collect = (destination, chunk) => {
      if (failure) return;
      size += chunk.length;
      if (size > OUTPUT_LIMIT) stop(new Error('llmdoc 运行时子进程输出超过限制。'));
      else destination.push(chunk);
    };
    child.stdout.on('data', (chunk) => collect(stdout, chunk));
    child.stderr.on('data', (chunk) => collect(stderr, chunk));
    child.on('error', () => {
      failure ??= new Error('无法启动已检测的 Node.js 可执行文件。');
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else
        resolve({
          code: code ?? -1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
    });
  });
}

/** @param {string} file @param {string} root @param {NodeJS.ProcessEnv} env @param {Run} run */
async function nodeVersion(file, root, env, run) {
  try {
    const outcome = await run(file, ['-p', NODE_PROBE], {
      cwd: dirname(file),
      env: windowsEnvironment(env, root),
      timeoutMs: 1200,
    });
    /** @type {unknown} */
    const info = outcome.code === 0 ? JSON.parse(outcome.stdout) : null;
    if (
      !record(info) ||
      info.release !== 'node' ||
      info.electron !== null ||
      typeof info.node !== 'string'
    )
      return false;
    const ver = /^(\d{1,3})\.(\d{1,4})\.\d{1,5}$/.exec(info.node);
    return !!ver && (Number(ver[1]) > 22 || (Number(ver[1]) === 22 && Number(ver[2]) >= 13));
  } catch {
    return false;
  }
}

/** @param {string} node @param {string[]} bins @param {string} root */
async function pairedNpm(node, bins, root) {
  const prefixes = [prefixFromBin(dirname(node)), ...bins.filter(localPath).map(prefixFromBin)];
  const candidates = [
    ...new Set(
      prefixes.flatMap((prefix) => [
        join(prefix, 'lib', 'node_modules', 'npm'),
        join(prefix, 'node_modules', 'npm'),
        join(prefix, 'share', 'nodejs', 'npm'),
      ])
    ),
  ];
  for (const path of candidates) {
    const pkg = await externalPath(path, root);
    if (!pkg || basename(pkg) !== 'npm' || !(await exists(pkg))?.isDirectory()) continue;
    const entry = join(pkg, 'bin', 'npm-cli.js');
    if ((await externalPath(entry, root)) !== entry || !(await exists(entry))?.isFile()) continue;
    const metadata = join(pkg, 'package.json');
    const stats = await exists(metadata);
    if (!stats?.isFile() || stats.size > 64 * 1024) continue;
    /** @type {unknown} */
    const info = await readFile(metadata, 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    if (
      !record(info) ||
      info.name !== 'npm' ||
      !record(info.bin) ||
      (info.bin.npm !== 'bin/npm-cli.js' && info.bin.npm !== './bin/npm-cli.js')
    )
      continue;
    // Distro npm under share/nodejs uses its sibling packages; upstream npm is bundled.
    const readDir = basename(dirname(pkg)) === 'nodejs' ? dirname(pkg) : pkg;
    return { entry, readDir };
  }
  return null;
}

/**
 * Resolve the plugin runtime afresh from explicit settings and trusted local layouts.
 * Creating the resolver/inspecting is read-only. Only the desktop's user action
 * should call install; it is intentionally not a model-facing tool.
 * @param {{dataDir: string, getConfig: () => Promise<Config>, validateCli: (config: Config, root: string) => Promise<{entry: string}>, validateGit: (config: Config, root: string) => Promise<string>, version: string, home?: string, env?: NodeJS.ProcessEnv, binDirs?: string[], run?: Run}} options
 */
export function createRuntimeSetup({
  dataDir,
  getConfig,
  validateCli,
  validateGit,
  version,
  home = homedir(),
  env = process.env,
  binDirs = systemBins(env),
  run = runProcess,
}) {
  if (version !== PINNED_VERSION) throw new Error(`llmdoc 仅支持固定版本 ${PINNED_VERSION}。`);
  const runtimeName = `runtime-${version}`;
  let installing = false;

  /** @param {Config} config @param {string} root */
  async function findNode(config, root) {
    const manual = explicit(config, 'nodeExecutable');
    const bins = manual ? [] : await nodeManagerBins(home, root);
    const files = manual
      ? [config.nodeExecutable]
      : [...bins, ...binDirs].filter(localPath).map((bin) => join(bin, NODE_NAME));
    const seen = new Set();
    let probes = 0;
    for (const file of files) {
      const node = await externalPath(file, root);
      if (
        !node ||
        seen.has(node) ||
        ![NODE_NAME, ...(!WINDOWS ? ['nodejs'] : [])].includes(basename(node).toLowerCase()) ||
        !(await nativeBinary(node))
      )
        continue;
      seen.add(node);
      if (++probes > PROBE_LIMIT) break;
      if (await nodeVersion(node, root, env, run)) return node;
    }
    return null;
  }

  /** @param {Config} config @param {string} root */
  async function findGit(config, root) {
    if (explicit(config, 'gitExecutable')) return validateGit(config, root).catch(() => null);
    for (const bin of binDirs.filter(localPath)) {
      const path = await externalPath(join(bin, GIT_NAME), root);
      if (!path || basename(path).toLowerCase() !== GIT_NAME || !(await nativeBinary(path)))
        continue;
      const git = await validateGit({ ...config, gitExecutable: path }, root).catch(() => null);
      if (git) return git;
    }
    return null;
  }

  /** @param {Config} config @param {string} root @param {string} node @param {string | null} privateDir */
  async function findCli(config, root, node, privateDir) {
    if (explicit(config, 'cliEntry'))
      return validateCli(config, root).then(
        (cli) => cli.entry,
        () => null
      );
    const prefixes = [
      ...(privateDir ? [join(privateDir, runtimeName)] : []),
      ...(localPath(home)
        ? [
            join(home, '.local', 'share', 'codekiln-llmdoc'),
            join(home, '.npm-global'),
            join(home, '.local'),
          ]
        : []),
      ...(WINDOWS && localPath(env.APPDATA) ? [join(env.APPDATA, 'npm')] : []),
      prefixFromBin(dirname(node)),
      ...binDirs.filter(localPath).map(prefixFromBin),
    ];
    for (const prefix of new Set(prefixes)) {
      for (const candidate of [cliEntry(prefix), cliEntry(join(prefix, 'lib'))]) {
        const path = await externalPath(candidate, root);
        if (!path || !(await exists(path))?.isFile()) continue;
        if (privateDir && !outside(join(privateDir, runtimeName), candidate) && path !== candidate)
          continue;
        const result = await validateCli({ ...config, cliEntry: path }, root).catch(() => null);
        if (result) return result.entry;
      }
    }
    return null;
  }

  /** @param {string} suppliedRoot */
  async function discover(suppliedRoot) {
    const root = localPath(suppliedRoot) ? await realpath(suppliedRoot).catch(() => null) : null;
    if (!localPath(root) || !(await exists(root))?.isDirectory())
      throw new Error('当前本机项目目录不可用。');
    const config = { ...(await getConfig()) };
    const privateDir =
      localPath(dataDir) && outside(root, dataDir) && (await exists(dataDir))?.isDirectory()
        ? await externalPath(dataDir, root)
        : null;
    const [node, git] = await Promise.all([findNode(config, root), findGit(config, root)]);
    if (!explicit(config, 'nodeExecutable') && node) config.nodeExecutable = node;
    if (!explicit(config, 'gitExecutable') && git) config.gitExecutable = git;
    const cli = node ? await findCli(config, root, node, privateDir) : null;
    if (!explicit(config, 'cliEntry') && cli) config.cliEntry = cli;
    return { config, root, node, git, cli, privateDir };
  }

  /** @type {Map<string, Promise<Awaited<ReturnType<typeof discover>>>>} */
  const discoveries = new Map();
  /** @param {string} root */
  function analyse(root) {
    const active = discoveries.get(root);
    if (active) return active;
    // The panel may call inspect and resolveConfig at once. Share only in-flight
    // work; file installs and user changes are observed on the next request.
    const pending = discover(root).finally(() => discoveries.delete(root));
    discoveries.set(root, pending);
    return pending;
  }

  /** @param {Awaited<ReturnType<typeof analyse>>} state */
  async function installEligibility(state) {
    const { config, node, privateDir, root } = state;
    if (explicit(config, 'cliEntry'))
      return { reason: '手工指定的 llmdoc CLI 不可用；请修正或清除配置后再安装。' };
    if (!node) return { reason: '缺少可用的外部 Node.js 22.13+；请先安装或修正手工配置。' };
    if (!privateDir) return { reason: '扩展私有目录不可用，不能安装。' };
    if (liveInstalls.has(privateDir)) return { reason: '已有 llmdoc 安装进行中。' };
    if (await exists(join(privateDir, runtimeName)))
      return { reason: '扩展私有目录中的 llmdoc 安装不兼容；不会覆盖现有目录。' };
    const npm = await pairedNpm(node, binDirs, root);
    return npm
      ? { npm }
      : { reason: '未找到此环境中受信任的 npm JS 入口；请先安装带 npm 的 Node.js。' };
  }

  return {
    /** @param {string} root */
    async resolveConfig(root) {
      const { config, node } = await analyse(root);
      // An explicit but incompatible executable must not reach the CLI runner.
      // This is ephemeral: the user setting and override precedence are unchanged.
      return !node && explicit(config, 'nodeExecutable')
        ? { ...config, nodeExecutable: undefined }
        : { ...config };
    },
    /** @param {string} root */
    async inspect(root) {
      const state = await analyse(root);
      const status = {
        nodeAvailable: !!state.node,
        cliAvailable: !!state.cli,
        gitAvailable: !!state.git,
        canInstall: false,
      };
      if (state.cli) return status;
      if (installing) return { ...status, installUnavailableReason: '已有 llmdoc 安装进行中。' };
      const result = await installEligibility(state);
      if (result.npm) return { ...status, canInstall: true };
      return { ...status, installUnavailableReason: result.reason };
    },
    /** @param {string} projectRoot @param {AbortSignal} signal */
    async install(projectRoot, signal) {
      checkCancelled(signal);
      if (installing) throw new Error('已有 llmdoc 安装进行中。');
      installing = true;
      /** @type {string | undefined} */
      let stage;
      /** @type {string | undefined} */
      let activeDir;
      try {
        const state = await analyse(projectRoot);
        checkCancelled(signal);
        if (state.cli) return { installed: false, alreadyPresent: /** @type {const} */ (true) };
        const { npm, reason } = await installEligibility(state);
        const { config, root, node, privateDir } = state;
        if (!npm || !node || !privateDir) throw new Error(reason ?? '当前环境无法安装 llmdoc。');
        checkCancelled(signal);
        if (liveInstalls.has(privateDir)) throw new Error('已有 llmdoc 安装进行中。');
        liveInstalls.add(privateDir);
        activeDir = privateDir;
        const destination = join(privateDir, runtimeName);
        const alreadyPresent = { installed: false, alreadyPresent: /** @type {const} */ (true) };
        const conflict = async () => {
          const current = await discover(root);
          checkCancelled(signal);
          if (current.cli) return alreadyPresent;
          throw new Error('扩展私有安装目录已存在；不会覆盖。');
        };
        if (await exists(destination)) return await conflict();
        stage = await mkdtemp(join(privateDir, `.staging-${version}-`));
        const prefix = join(stage, 'publish');
        const cache = join(stage, 'npm-cache');
        const sandboxHome = join(stage, 'home');
        const tmp = join(stage, 'tmp');
        await Promise.all(
          [prefix, cache, sandboxHome, tmp].map((path) => mkdir(path, { mode: 0o700 }))
        );
        const userconfig = join(stage, 'user-npmrc');
        const globalconfig = join(stage, 'global-npmrc');
        await Promise.all([
          writeFile(userconfig, '', { mode: 0o600 }),
          writeFile(globalconfig, '', { mode: 0o600 }),
          writeFile(join(prefix, 'package.json'), '{"private":true}\n', { mode: 0o600 }),
        ]);
        checkCancelled(signal);
        const result = await run(
          node,
          [
            '--permission',
            `--allow-fs-read=${stage}`,
            `--allow-fs-write=${stage}`,
            `--allow-fs-read=${npm.readDir}`,
            npm.entry,
            'install',
            `--prefix=${prefix}`,
            `--cache=${cache}`,
            `--userconfig=${userconfig}`,
            `--globalconfig=${globalconfig}`,
            `--registry=${REGISTRY}`,
            '--strict-ssl=true',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            '--no-update-notifier',
            '--no-progress',
            '--fetch-retries=0',
            '--fetch-timeout=30000',
            '--omit=dev',
            '--bin-links=false',
            '--save-exact',
            `@tokenroll/llmdoc@${version}`,
          ],
          {
            cwd: prefix,
            signal,
            timeoutMs: 90_000,
            env: {
              ...windowsEnvironment(env, root),
              HOME: sandboxHome,
              USERPROFILE: sandboxHome,
              APPDATA: sandboxHome,
              LOCALAPPDATA: sandboxHome,
              TMPDIR: tmp,
              TMP: tmp,
              TEMP: tmp,
            },
          }
        );
        checkCancelled(signal);
        if (result.code !== 0)
          throw new Error(
            `llmdoc 安装失败（npm 退出码 ${result.code}）。请检查网络和官方 npm registry。`
          );
        const entry = cliEntry(prefix);
        try {
          if ((await realpath(entry)) !== entry) throw new Error('symlinked entry');
          await validateCli({ ...config, cliEntry: entry }, root);
        } catch {
          throw new Error(`安装未生成可用的 @tokenroll/llmdoc@${version}；未发布到扩展私有目录。`);
        }
        const latest = await getConfig();
        if (explicit(latest, 'cliEntry')) {
          const current = await discover(root);
          checkCancelled(signal);
          if (current.cli) return alreadyPresent;
          throw new Error('手工指定的 llmdoc CLI 不可用；不会覆盖或发布托管安装。');
        }
        if (await exists(destination)) return await conflict();
        checkCancelled(signal);
        try {
          // The directory published by a competing process is nonempty, so an
          // atomic same-filesystem rename cannot replace it on POSIX or Windows.
          await rename(prefix, destination);
        } catch (error) {
          if (await exists(destination)) return await conflict();
          throw error;
        }
        return { installed: true };
      } finally {
        try {
          if (stage) await rm(stage, { recursive: true, force: true });
        } finally {
          if (activeDir) liveInstalls.delete(activeDir);
          installing = false;
        }
      }
    },
  };
}
