import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, open, opendir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerLookupNudge } from './events.mjs';
import { registerMaintenance } from './maintenance.mjs';
import { createRuntimeSetup } from './setup.mjs';

const CLI_VERSION = '3.6.0';
const CLI_TIMEOUT = 5_000;
const OUTPUT_BYTES = 48 * 1024;
const MAX_ENTRIES = 1_000;
const MAX_FILE_BYTES = 512 * 1024;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const CURSOR = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const READ_GIT = fileURLToPath(new URL('./read-git.cjs', import.meta.url));
const GIT_GUARD_MARKER = 'LLMDOC_READ_GIT_ERROR: ';
const OPS = {
  tree: { keys: ['cursor'], limit: 30, budget: 1400 },
  search: { keys: ['query', 'cursor'], limit: 12, budget: 1400 },
  show: { keys: ['id'], limit: 1, budget: 2000 },
  context: { keys: ['files', 'cursor'], limit: 30, budget: 1400 },
  status: { keys: [], limit: 30, budget: 1400, git: true },
  delta: { keys: ['cursor'], limit: 30, budget: 1400, git: true },
  validate: { keys: [], limit: 30, budget: 1400, git: true },
  prune_report: { keys: [], limit: 30, budget: 1400 },
  upgrade: { keys: [], limit: 30, budget: 1400, git: true },
};

/** @typedef {keyof typeof OPS} Operation */
/** @typedef {{cursor?: string, query?: string, id?: string, files?: string[]}} RetrievalArgs */
/** @typedef {import('../../../types/enso-plugin').InvocationContext} InvocationContext */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value @returns {value is string} */
const localAbsolute = (value) =>
  typeof value === 'string' &&
  value.length <= 4096 &&
  isAbsolute(value) &&
  !CONTROL.test(value) &&
  !value.includes('*') &&
  (process.platform !== 'win32' || /^[A-Za-z]:[/\\]/.test(value));

/** @param {string} root @param {string} path */
function contains(root, path) {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

/** @param {AbortSignal | undefined} signal */
function checkCancelled(signal) {
  if (signal?.aborted) throw new Error('llmdoc 调用已取消。');
}

/** @param {unknown} value */
function documentId(value) {
  if (
    typeof value !== 'string' ||
    value.length > 240 ||
    !value.startsWith('llmdoc/') ||
    !value.endsWith('.mdx') ||
    CONTROL.test(value)
  ) {
    throw new Error('文档 ID 必须是 tree/search 返回的 llmdoc/…/*.mdx 路径。');
  }
  const parts = value.slice('llmdoc/'.length).split('/');
  if (
    parts.length > 2 ||
    parts.at(-1) === '.mdx' ||
    parts.some(
      (part) =>
        !part ||
        part !== part.trim() ||
        part.endsWith('.') ||
        /[\\:*?"<>|]/.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)
    )
  ) {
    throw new Error('文档 ID 只能指向 llmdoc/ 下的 V3 文档（根目录或单层主题）。');
  }
  return value;
}

/** @param {Operation} op @param {unknown} args @returns {RetrievalArgs} */
function readArgs(op, args) {
  const value = args === undefined ? {} : args;
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !OPS[op].keys.some((allowed) => allowed === key))
  ) {
    throw new Error('llmdoc 参数不合法。');
  }
  if (
    value.cursor !== undefined &&
    (typeof value.cursor !== 'string' || !CURSOR.test(value.cursor))
  ) {
    throw new Error('请使用上一页返回的游标。');
  }
  if (op === 'show') return { id: documentId(value.id) };
  if (op === 'context') {
    if (!Array.isArray(value.files) || value.files.length === 0 || value.files.length > 16) {
      throw new Error('context 需要 1–16 个项目相对源码路径。');
    }
    return {
      files: Array.from(new Set(Array.from(value.files, sourcePath))),
      cursor: value.cursor,
    };
  }
  if (op === 'search') {
    const query = typeof value.query === 'string' ? value.query.trim() : '';
    if (
      typeof value.query !== 'string' ||
      value.query.length > 200 ||
      CONTROL.test(value.query) ||
      !query ||
      query.startsWith('-')
    ) {
      throw new Error('搜索关键词必须是 1–200 字符的单行文本，且不能以“-”开头。');
    }
    return { query, cursor: value.cursor };
  }
  return { cursor: value.cursor };
}

/** @param {unknown} value */
function sourcePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 240 ||
    value.startsWith('-') ||
    CONTROL.test(value) ||
    /[\\:*?"<>|]/.test(value) ||
    value
      .split('/')
      .some(
        (part) =>
          !part ||
          part !== part.trim() ||
          part.endsWith('.') ||
          part.toLowerCase() === '.git' ||
          /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)
      )
  ) {
    throw new Error(
      '源码路径必须是 1–240 字符的项目相对文件路径，不得包含旗标、控制字符或越界段。'
    );
  }
  return value;
}

/** @param {string} root @param {string[]} files */
async function confirmSourcePaths(root, files) {
  for (const file of files) {
    let path = root;
    const segments = file.split('/');
    for (const [i, segment] of segments.entries()) {
      path = join(path, segment);
      const stat = await lookup(path);
      if (!stat) break; // A valid path may have been deleted or be planned for creation.
      if (stat.isSymbolicLink()) throw new Error('源码路径不支持符号链接。');
      if (i === segments.length - 1 ? !stat.isFile() : !stat.isDirectory()) {
        throw new Error('源码路径必须指向文件。');
      }
    }
  }
}

/** @param {string} path */
async function lookup(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/** @param {string} path @param {string} label */
async function smallFile(path, label, max = MAX_FILE_BYTES) {
  const stat = await lookup(path);
  if (!stat) return null;
  if (!stat.isFile() || stat.size > max) {
    throw new Error(`${label} 必须是普通文件，不支持符号链接或过大的文件。`);
  }
  return stat;
}

/** @param {InvocationContext} ctx */
export async function gitRoot(ctx) {
  if (!ctx?.sessionId || !localAbsolute(ctx.projectRoot)) {
    throw new Error('请在本机 Code Git 项目会话中打开 llmdoc。');
  }
  const root = await realpath(ctx.projectRoot).catch(() => null);
  if (!localAbsolute(root)) throw new Error('当前本机 Code 项目目录不可用。');
  const marker = join(root, '.git');
  const stat = await lookup(marker);
  // Honor the host's exact workspace root, including linked worktrees; never walk to a parent.
  const git = stat?.isDirectory()
    ? (await lookup(join(marker, 'HEAD')))?.isFile()
    : stat?.isFile() &&
      stat.size <= 4096 &&
      /^gitdir: [^\r\n]+\r?\n?$/.test(await readFile(marker, 'utf8'));
  if (!git) throw new Error('当前项目目录不是 Git 工作树根目录。');
  return root;
}

/** @param {unknown} config @param {string} root */
export async function resolveGitExecutable(config, root) {
  if (!isRecord(config) || !localAbsolute(config.gitExecutable)) {
    throw new Error('请在扩展设置中填写项目之外独立安装的 Git 可执行文件绝对路径。');
  }
  const git = await realpath(config.gitExecutable).catch(() => null);
  if (
    !localAbsolute(git) ||
    contains(root, git) ||
    !(await lookup(git))?.isFile() ||
    (process.platform === 'win32' && !git.toLowerCase().endsWith('.exe')) ||
    !(await access(git, constants.X_OK).then(
      () => true,
      () => false
    ))
  ) {
    throw new Error('配置的 Git 不可执行；请选择项目之外受信任的本机 Git。');
  }
  return git;
}

/** @param {string} root */
async function gitMetadata(root) {
  const marker = join(root, '.git');
  const stat = await lookup(marker);
  let dir = marker;
  if (stat?.isFile() && stat.size <= 4096) {
    const pointer = /^gitdir: ([^\r\n]+)\r?\n?$/.exec(await readFile(marker, 'utf8'))?.[1];
    if (!pointer || CONTROL.test(pointer)) throw new Error('Git 工作树元数据路径无效。');
    dir = await realpath(resolve(root, pointer)).catch(() => '');
  }
  if (
    !localAbsolute(dir) ||
    !(await lookup(dir))?.isDirectory() ||
    !(await lookup(join(dir, 'HEAD')))?.isFile()
  ) {
    throw new Error('Git 工作树元数据目录或 HEAD 不可用。');
  }
  await smallFile(join(dir, 'config.worktree'), 'Git config.worktree');
  return dir;
}

/** @param {string} root @param {Operation} op @param {AbortSignal} signal */
async function workspace(root, op, signal) {
  const dir = join(root, 'llmdoc');
  const stat = await lookup(dir);
  if (op === 'upgrade' && !stat) return new Set();
  if (!stat?.isDirectory()) {
    throw new Error('当前 Git 项目缺少 llmdoc/ 普通目录（不支持符号链接）。');
  }
  await smallFile(join(root, 'llmdoc.config.json'), 'llmdoc.config.json');
  if (op === 'search') {
    const tmp = join(root, '.llmdoc-tmp');
    const cache = join(tmp, 'cache');
    for (const path of [tmp, cache]) {
      const stat = await lookup(path);
      if (!stat) break;
      if (!stat.isDirectory()) throw new Error('llmdoc 搜索缓存目录不支持符号链接。');
      if (path === cache)
        await smallFile(join(cache, 'search-index.json'), 'llmdoc 搜索缓存', 16 * 1024 * 1024);
    }
  }
  const ids = new Set();
  let count = 0;
  let bytes = 0;
  /** @param {string} path */
  async function scan(path, topic = '', depth = 0) {
    for await (const entry of await opendir(path)) {
      checkCancelled(signal);
      if (++count > MAX_ENTRIES) throw new Error('llmdoc/ 条目过多（上限 1000）。');
      const file = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error('llmdoc/ 内不允许符号链接。');
      if (entry.isDirectory()) {
        if (op !== 'upgrade' && topic) throw new Error('llmdoc V3 只支持单层主题目录。');
        if (depth >= 12) throw new Error('llmdoc/ 旧版目录过深（上限 12 层）。');
        await scan(file, topic ? `${topic}/${entry.name}` : entry.name, depth + 1);
      } else if (entry.name.endsWith('.mdx')) {
        const path = `llmdoc/${topic ? `${topic}/` : ''}${entry.name}`;
        const id = op === 'upgrade' ? `llmdoc/${entry.name}` : documentId(path);
        const stat = await smallFile(file, id);
        if (!stat) throw new Error('llmdoc 文档已变更，请刷新后重试。');
        bytes += stat.size;
        if (bytes > 8 * 1024 * 1024) throw new Error('llmdoc/ 文档总大小超过 8 MiB。');
        // Upstream passes raw MDX to gray-matter, whose alternate JS engine evaluates
        // front matter. Only the standard YAML opening line is allowed in this adapter.
        const handle = await open(file, 'r');
        try {
          const prefix = Buffer.alloc(8);
          const { bytesRead } = await handle.read(prefix);
          if (!/^\uFEFF?---\r?\n/.test(prefix.toString('utf8', 0, bytesRead))) {
            throw new Error(`${id} 必须以单独一行“---”开始 YAML front matter。`);
          }
        } finally {
          await handle.close();
        }
        if (op !== 'upgrade') ids.add(id);
      } else if (!topic && entry.name === 'meta.json') {
        await smallFile(file, 'llmdoc/meta.json');
      }
    }
  }
  await scan(dir);
  return ids;
}

/** @param {unknown} config @param {string} root */
export async function executable(config, root) {
  if (
    !isRecord(config) ||
    !localAbsolute(config.nodeExecutable) ||
    !localAbsolute(config.cliEntry)
  ) {
    throw new Error('请在扩展设置中填写外部 Node.js 和 llmdoc CLI JS 入口的本机绝对路径。');
  }
  const node = await realpath(config.nodeExecutable).catch(() => null);
  if (
    !localAbsolute(node) ||
    !(await lookup(node))?.isFile() ||
    contains(root, node) ||
    (process.platform === 'win32' && !node.toLowerCase().endsWith('.exe'))
  ) {
    throw new Error('Node.js 路径不可用；请选择项目之外的受信任 Node.js 22.13+ 可执行文件。');
  }
  const entry = await realpath(config.cliEntry).catch(() => null);
  if (!localAbsolute(entry) || !(await lookup(entry))?.isFile()) {
    throw new Error('找不到已安装的 llmdoc CLI JS 入口。');
  }
  const pkg = dirname(dirname(dirname(entry)));
  const modules = dirname(dirname(pkg));
  const expected = join(modules, '@tokenroll', 'llmdoc', 'dist', 'bin', 'llmdoc.js');
  if (
    basename(modules) !== 'node_modules' ||
    entry !== expected ||
    contains(root, modules) ||
    contains(modules, root)
  ) {
    throw new Error('请选择项目之外独立安装的 @tokenroll/llmdoc/dist/bin/llmdoc.js。');
  }
  const metadata = join(pkg, 'package.json');
  const manifest = await smallFile(metadata, 'llmdoc package.json', 32 * 1024);
  /** @type {unknown} */
  const info = manifest
    ? await readFile(metadata, 'utf8')
        .then(JSON.parse)
        .catch(() => null)
    : null;
  if (
    !isRecord(info) ||
    info.name !== '@tokenroll/llmdoc' ||
    info.version !== CLI_VERSION ||
    !isRecord(info.bin) ||
    info.bin.llmdoc !== './dist/bin/llmdoc.js'
  ) {
    throw new Error(`此插件只支持独立安装的 @tokenroll/llmdoc@${CLI_VERSION}。`);
  }
  return { node, entry, modules };
}

/**
 * @param {Awaited<ReturnType<typeof executable>>} runtime
 * @param {string} root @param {Operation} op @param {RetrievalArgs} args @param {AbortSignal} signal
 * @param {{git: string, metadata: string} | undefined} gitRuntime
 * @returns {Promise<{stdout: string, exitCode: number}>}
 */
function execute({ node, entry, modules }, root, op, args, signal, gitRuntime) {
  const { budget, limit } = OPS[op];
  const argv = ['--permission', `--allow-fs-read=${root}`, `--allow-fs-read=${modules}`];
  if (gitRuntime) {
    if (!localAbsolute(READ_GIT)) throw new Error('llmdoc 只读 Git 护栏路径无效。');
    argv.push('--allow-child-process', `--allow-fs-read=${READ_GIT}`, '--require', READ_GIT);
    for (const path of [
      'config.worktree',
      'rebase-merge',
      'rebase-apply',
      'MERGE_HEAD',
      'CHERRY_PICK_HEAD',
    ]) {
      argv.push(`--allow-fs-read=${join(gitRuntime.metadata, path)}`);
    }
  }
  argv.push(entry, '--json', '--limit', String(limit), '--budget', String(budget));
  if (args.cursor) argv.push('--cursor', args.cursor);
  if (op === 'tree') argv.push('tree', '--docs');
  if (args.query !== undefined) argv.push('search', '--', args.query);
  if (args.id !== undefined) argv.push('show', args.id);
  if (args.files) argv.push('context', '--files', ...args.files);
  if (op === 'prune_report') argv.push('prune', '--report');
  if (op === 'delta' || op === 'status' || op === 'validate' || op === 'upgrade') argv.push(op);

  // No writes: upstream search catches its cache write failure. For Git-backed reads
  // the preload allowlists child requests; do not forward PATH or arbitrary host env.
  const env = {
    ...(process.platform === 'win32' && process.env.SystemRoot
      ? { SystemRoot: process.env.SystemRoot }
      : {}),
    ...(gitRuntime
      ? {
          LLMDOC_READ_ROOT: root,
          LLMDOC_READ_GIT: gitRuntime.git,
          LLMDOC_READ_METADATA: gitRuntime.metadata,
        }
      : {}),
  };
  return new Promise((resolve, reject) => {
    execFile(
      node,
      argv,
      {
        cwd: root,
        env,
        shell: false,
        windowsHide: true,
        signal,
        timeout: CLI_TIMEOUT,
        killSignal: 'SIGKILL',
        maxBuffer: OUTPUT_BYTES,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error?.code === 'ABORT_ERR') return reject(new Error('llmdoc 调用已取消。'));
        const guardError =
          gitRuntime && stderr.split(/\r?\n/).find((line) => line.startsWith(GIT_GUARD_MARKER));
        if (guardError)
          return reject(
            new Error(
              `llmdoc Git 只读检查失败：${guardError.slice(GIT_GUARD_MARKER.length).slice(0, 320)}`
            )
          );
        if (!error) return resolve({ stdout, exitCode: 0 });
        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
          return reject(new Error('llmdoc 输出超过 48 KiB；请缩小搜索范围或拆分过长文档。'));
        if (error.killed) return reject(new Error('llmdoc 执行超时（5 秒）。'));
        if (typeof error.code === 'string')
          return reject(new Error(`无法启动已配置的 Node.js（${error.code}）。`));
        if (op === 'validate' && error.code === 1) return resolve({ stdout, exitCode: 1 });
        const hint = (stdout.trim() || stderr.trim())
          .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
          .slice(0, 360);
        return reject(
          new Error(`llmdoc 退出失败（${error.code ?? error.signal}）。${hint ? ` ${hint}` : ''}`)
        );
      }
    );
  });
}

const badOutput = () => new Error('llmdoc 未返回有效的 V3 JSON；请检查 CLI 版本或过长的文档。');

/** @param {string} raw @param {Operation} op @param {RetrievalArgs} args @param {Set<string>} ids */
function projectResult(raw, op, args, ids) {
  /** @type {unknown} */
  const data = JSON.parse(raw);
  if (!isRecord(data)) throw badOutput();
  const rows = op === 'search' ? data.results : data.documents;
  const page = data.pagination;
  if (
    !Array.isArray(rows) ||
    rows.length > OPS[op].limit ||
    (op === 'tree' && data.root !== 'llmdoc') ||
    !isRecord(page) ||
    typeof page.totalItems !== 'number' ||
    !Number.isInteger(page.totalItems) ||
    page.totalItems < rows.length ||
    page.totalItems > MAX_ENTRIES ||
    page.returnedItems !== rows.length ||
    (page.nextCursor !== null &&
      (typeof page.nextCursor !== 'string' || !CURSOR.test(page.nextCursor)))
  ) {
    throw badOutput();
  }
  /** @type {unknown[]} */
  const documents = rows;
  const entries = documents.map((row) => {
    if (!isRecord(row)) throw badOutput();
    const id = documentId(row.path);
    if (
      !ids.has(id) ||
      typeof row.kind !== 'string' ||
      !['architecture', 'guide', 'reference'].includes(row.kind) ||
      typeof row.description !== 'string'
    )
      throw badOutput();
    const result = { id, kind: row.kind, description: row.description.slice(0, 320) };
    if (op === 'search') {
      if (typeof row.snippet !== 'string') throw badOutput();
      return { ...result, snippet: row.snippet.slice(0, 480) };
    }
    return result;
  });
  if (op !== 'show') return { entries, total: page.totalItems, nextCursor: page.nextCursor };
  const row = documents[0];
  if (
    !isRecord(row) ||
    entries.length !== 1 ||
    entries[0].id !== args.id ||
    typeof row.body !== 'string'
  )
    throw badOutput();
  return {
    ...entries[0],
    body: row.body.slice(0, 12000),
    ...(row.body.length > 12000 ? { bodyTruncated: true } : {}),
  };
}

/** @param {unknown} page @param {number} limit @param {number} returned */
function validPage(page, limit, returned) {
  return (
    isRecord(page) &&
    returned <= limit &&
    typeof page.totalItems === 'number' &&
    Number.isInteger(page.totalItems) &&
    page.totalItems >= returned &&
    page.totalItems <= MAX_ENTRIES &&
    page.returnedItems === returned &&
    (page.nextCursor === null ||
      (typeof page.nextCursor === 'string' && CURSOR.test(page.nextCursor)))
  );
}

/** @param {string} stdout @param {number} exitCode @param {Operation} operation */
function diagnosticResult(stdout, exitCode, operation) {
  /** @type {unknown} */
  const result = JSON.parse(stdout);
  if (!isRecord(result)) throw badOutput();
  // The pinned CLI already validates its full output schema before emission.
  // Check the operation and key discriminants here, especially validate exit 1.
  switch (operation) {
    case 'context':
      if (
        !Array.isArray(result.impacted) ||
        !Array.isArray(result.prerequisites) ||
        !Array.isArray(result.unmappedFiles) ||
        !validPage(
          result.pagination,
          OPS.context.limit,
          result.impacted.length + result.prerequisites.length
        )
      )
        throw badOutput();
      break;
    case 'delta':
      if (
        !['light', 'deep'].some((mode) => mode === result.suggestedMode) ||
        !(result.degradedReason === null || typeof result.degradedReason === 'string') ||
        !Array.isArray(result.reasons) ||
        !isRecord(result.unmapped) ||
        !Array.isArray(result.impacted) ||
        !Array.isArray(result.needsReview) ||
        !validPage(
          result.pagination,
          OPS.delta.limit,
          result.impacted.length + result.needsReview.length
        )
      )
        throw badOutput();
      break;
    case 'status':
      if (
        !(result.degradedReason === null || typeof result.degradedReason === 'string') ||
        !isRecord(result.documents) ||
        !isRecord(result.unmapped) ||
        !isRecord(result.growth)
      )
        throw badOutput();
      break;
    case 'validate':
      if (
        result.ok !== (exitCode === 0) ||
        !Array.isArray(result.errors) ||
        (result.errors.length === 0) !== (exitCode === 0) ||
        !Array.isArray(result.warnings)
      )
        throw badOutput();
      break;
    case 'prune_report':
      if (
        result.status !== 'dry_run' ||
        result.writable !== false ||
        !isRecord(result.growth) ||
        !Array.isArray(result.startupPreloads) ||
        !Array.isArray(result.duplicateCandidates) ||
        !Array.isArray(result.mergeCandidates)
      )
        throw badOutput();
      break;
    case 'upgrade':
      if (
        !['no_change', 'dry_run'].some((status) => status === result.status) ||
        typeof result.summary !== 'string' ||
        typeof result.requiresRecorderSemanticMigration !== 'boolean' ||
        !Array.isArray(result.legacyPaths) ||
        !Array.isArray(result.targetStructure) ||
        !Array.isArray(result.notes)
      )
        throw badOutput();
      break;
    default:
      throw badOutput();
  }
  return { operation, result, exitCode };
}

/** @param {import('../../../types/enso-plugin').PluginMainApi} enso */
export function activate(enso) {
  const setup = createRuntimeSetup({
    dataDir: enso.dataDir,
    getConfig: () => enso.config.get(),
    validateCli: executable,
    validateGit: resolveGitExecutable,
    version: CLI_VERSION,
  });
  let busy = 0;
  /** @type {((input: unknown, ctx: InvocationContext) => Promise<unknown>) | null} */
  let statusInvoke = null;
  for (const op of /** @type {Operation[]} */ (Object.keys(OPS))) {
    /** @param {unknown} input @param {InvocationContext} ctx */
    const invoke = async (input, ctx) => {
      const args = readArgs(op, input);
      checkCancelled(ctx?.signal);
      if (busy >= 2) throw new Error('llmdoc 正在处理其他请求，请稍后重试。');
      busy++;
      try {
        const root = await gitRoot(ctx);
        const config = await setup.resolveConfig(root);
        const runtime = await executable(config, root);
        const gitRuntime =
          'git' in OPS[op]
            ? { git: await resolveGitExecutable(config, root), metadata: await gitMetadata(root) }
            : undefined;
        if (args.files) await confirmSourcePaths(root, args.files);
        const ids = await workspace(root, op, ctx.signal);
        if (args.id && !ids.has(args.id))
          throw new Error('当前项目没有此文档 ID，请先刷新知识地图。');
        checkCancelled(ctx.signal);
        try {
          const { stdout, exitCode } = await execute(
            runtime,
            root,
            op,
            args,
            ctx.signal,
            gitRuntime
          );
          if (op === 'tree' || op === 'search' || op === 'show')
            return projectResult(stdout, op, args, ids);
          return diagnosticResult(stdout, exitCode, op);
        } catch (error) {
          if (error instanceof SyntaxError) throw badOutput();
          throw error;
        }
      } finally {
        busy--;
      }
    };
    if (op === 'status') statusInvoke = invoke;
    if (op !== 'upgrade') enso.renderer.handle(op, invoke);
    enso.tools.register(op, async (input, ctx) => ({
      content: JSON.stringify(await invoke(input, ctx)),
    }));
  }
  registerMaintenance(enso, { gitRoot, executable, resolveGitExecutable, setup });
  registerLookupNudge(enso, {
    projectRoot: (ctx) => {
      const root = /** @type {{projectRoot?: unknown} | null | undefined} */ (ctx)?.projectRoot;
      return typeof root === 'string' ? root : null;
    },
    ready: async (root) => executable(await setup.resolveConfig(root), root),
    review: async (root) => {
      if (!statusInvoke) return null;
      const outcome = await statusInvoke(
        {},
        /** @type {InvocationContext} */ ({
          projectRoot: root,
          sessionId: 'llmdoc-agent-end-review',
        })
      );
      if (!isRecord(outcome) || outcome.operation !== 'status' || !isRecord(outcome.result))
        return null;
      const documents = outcome.result.documents;
      const unmapped = outcome.result.unmapped;
      if (!isRecord(documents) || !isRecord(unmapped)) return null;
      const impacted = documents.impacted;
      const needsReview = documents.needsReview;
      const committed = unmapped.committed;
      const dirty = unmapped.dirty;
      if (
        !Number.isInteger(impacted) ||
        !Number.isInteger(needsReview) ||
        !Array.isArray(committed) ||
        !Array.isArray(dirty)
      )
        return null;
      return {
        impacted,
        needsReview,
        unmapped: committed.length + dirty.length,
      };
    },
  });
}
