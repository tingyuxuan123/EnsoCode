import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { isSecretFilePath } from '../protectedActions';
import { matchLines } from './matcher';
import { check, fail, object } from './safety';

/**
 * 扫描类预算（文件数/目录项/物理读取）耗尽时只把当次命令标为 partial，不终止整次搜索；
 * 发往云端的累计输出（totalBytes）才是数据外发上限，耗尽后不再回传正文。
 * 中型仓库的单个源码目录常有 600+ 文件，单命令上限按此留足余量。
 */
export const LIMITS = {
  fileBytes: 512 * 1024,
  filesVisited: 4096,
  entries: 16384,
  totalFilesVisited: 8192,
  totalEntries: 131072,
  stepReadBytes: 16 * 1024 * 1024,
  totalReadBytes: 32 * 1024 * 1024,
  finalReadBytes: 8 * 1024 * 1024,
  stepBytes: 24 * 1024,
  totalBytes: 192 * 1024,
  snippetBytes: 48 * 1024,
  finalFiles: 8,
  finalRanges: 16,
};

const GENERATED =
  /^(?:\.git|node_modules|dist|build|coverage|\.next|\.cache|vendor|\.ssh|\.dsh|\.piwin|\.pi)$/i;
/** Any path segment matching these names is excluded, not only the basename. */
const SENSITIVE_SEGMENT =
  /(?:^\.env(?:\.|$)|credential|secret|(?:^|[._-])(?:token|private.?key|id_rsa|id_ed25519)(?:[._-]|$)|\.(?:pem|key|p12|pfx|keystore)$)/i;

/** Hard exclusions cannot be re-enabled by any nested .gitignore negation. */
function forbidden(path: string): boolean {
  return (
    path
      .split(/[\\/]/)
      .filter(Boolean)
      .some((part) => GENERATED.test(part) || SENSITIVE_SEGMENT.test(part)) ||
    isSecretFilePath(path)
  );
}

function contains(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

interface Rule {
  base: string;
  matcher: Ignore;
}

interface Scan {
  entries: number;
  files: number;
  partial: boolean;
}

interface CachedText {
  text: string;
  ino: number;
  dev: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

const PARTIAL =
  '\n[PARTIAL] Scan/output limit reached; this is not proof of no matches. Use ls to discover directories, then narrow the command path and continue. Only return verified file ranges.';
const OUTPUT_EXHAUSTED =
  '[PARTIAL] Command output budget for this search is exhausted; nothing more was returned. Call ANSWER now using only file ranges already observed.';

interface Listing {
  name: string;
  directory: boolean;
  file: boolean;
}

/** Bounded wildcard DP: no model-controlled JavaScript regular expression or shell. */
function wildcard(pattern: string, text: string): boolean {
  let row = new Array<boolean>(text.length + 1).fill(false);
  row[0] = true;
  for (const ch of pattern) {
    const next = new Array<boolean>(text.length + 1).fill(false);
    next[0] = ch === '*' && row[0]!;
    for (let i = 1; i <= text.length; i++) {
      next[i] =
        ch === '*' ? next[i - 1]! || row[i]! : (ch === '?' || ch === text[i - 1]) && row[i - 1]!;
    }
    row = next;
  }
  return row[text.length]!;
}

export interface Command {
  op: 'rg' | 'readfile' | 'tree' | 'ls' | 'glob';
  path?: string;
  pattern?: string;
  literal?: boolean;
  start?: number;
  end?: number;
}

export function command(value: unknown): Command {
  const v = object(value);
  if (
    !v ||
    !['rg', 'readfile', 'tree', 'ls', 'glob'].includes(String(v.op)) ||
    Object.keys(v).some((k) => !['op', 'path', 'pattern', 'literal', 'start', 'end'].includes(k))
  ) {
    return fail('protocol', 'Invalid restricted_exec command.');
  }
  if (v.path !== undefined && (typeof v.path !== 'string' || v.path.length > 1024)) {
    return fail('bounds', 'Invalid command path.');
  }
  if (v.pattern !== undefined && (typeof v.pattern !== 'string' || v.pattern.length > 256)) {
    return fail('bounds', 'Search pattern exceeds its budget.');
  }
  if (v.literal !== undefined && typeof v.literal !== 'boolean') {
    return fail('protocol', 'Invalid literal flag; expected boolean.');
  }
  // 检索模型确实会发出缺 pattern 的 rg；在执行前拒绝，让循环回执纠正而不是执行中途致命失败。
  if (v.op === 'rg' && (typeof v.pattern !== 'string' || !v.pattern.trim())) {
    return fail('bounds', 'Literal rg requires a nonempty pattern.');
  }
  for (const n of [v.start, v.end]) {
    if (
      n !== undefined &&
      (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1 || n > 1_000_000)
    ) {
      return fail('bounds', 'Invalid line window.');
    }
  }
  return v as unknown as Command;
}

interface ObservedRange {
  path: string;
  start: number;
  end: number;
}

interface Observation extends ObservedRange {
  readfile: boolean;
  order: number;
}

interface DeliveredLine {
  endByte: number;
  range: ObservedRange;
  readfile: boolean;
}

export class LocalWorkspace {
  private entries = 0;
  private visited = 0;
  private bytes = 0;
  private readBytes = 0;
  private finalReadBytes = 0;
  private observations: Observation[] = [];
  private observationOrder = 0;
  private rules: Rule[] = [];
  private loadedRules = new Set<string>();
  private visitedPaths = new Set<string>();
  private textCache = new Map<string, CachedText>();
  /** 目录列表缓存：同一次搜索内重复扫描不再重读目录，也不重复消耗目录项总预算 */
  private listings = new Map<string, Listing[]>();
  partial = false;

  private constructor(
    readonly cwd: string,
    readonly root: string,
    private readonly rootRel: string,
    private readonly signal: AbortSignal
  ) {}

  static async create(
    cwd: string,
    relativePath: string | undefined,
    signal: AbortSignal
  ): Promise<LocalWorkspace> {
    check(signal);
    if (!cwd || !isAbsolute(cwd)) {
      return fail('path', 'code_search requires an authoritative absolute session cwd.');
    }
    try {
      const host = await realpath(cwd);
      if (!(await lstat(host)).isDirectory()) {
        return fail('path', 'Session cwd is not a directory.');
      }
      const requested = (relativePath ?? '').trim().replace(/\\/g, '/');
      if (isAbsolute(requested) || requested.split('/').some((part) => part === '..')) {
        return fail('path', 'Search path must be a relative path inside the session cwd.');
      }
      let root = host;
      for (const part of requested.split('/').filter(Boolean)) {
        root = resolve(root, part);
        if (!contains(host, root)) {
          return fail('path', 'Search path escapes the session cwd.');
        }
        const info = await lstat(root);
        if (info.isSymbolicLink() || !info.isDirectory()) {
          return fail('path', 'Search path must be a real directory inside the session cwd.');
        }
      }
      if ((await realpath(root)) !== root) {
        return fail('path', 'Search path changed or escaped the session cwd.');
      }
      const rootRel = relative(host, root).split(sep).join('/');
      if (forbidden(rootRel)) {
        return fail('path', 'Sensitive or generated paths are excluded.');
      }
      return new LocalWorkspace(host, root, rootRel, signal);
    } catch (error) {
      if (error instanceof Error && error.name === 'DevinError') throw error;
      return fail('path', 'Unable to resolve a permitted local search folder.');
    }
  }

  virtual(input: string): string {
    // 模型常省略 /codebase 前缀（src/a.ts、./src、codebase/src）；只补前缀，穿越与主机绝对路径仍拒绝
    let path = input.trim();
    while (path.startsWith('./')) path = path.slice(2);
    if (path === 'codebase' || path.startsWith('codebase/')) path = `/${path}`;
    else if (path && path !== '.' && !path.startsWith('/')) path = `/codebase/${path}`;
    path = path.replace(/\/+$/, '') || path;
    if (path === '/codebase' || path === '.' || path === '') return '';
    if (
      !path.startsWith('/codebase/') ||
      path.includes('\\') ||
      path.split('/').some((p) => p === '..' || p === '.')
    ) {
      return fail('path', 'Only contained /codebase virtual paths are permitted.');
    }
    const rel = path.slice('/codebase/'.length);
    if (forbidden(rel)) return fail('path', 'Sensitive or generated paths are excluded.');
    return rel;
  }

  private hostPath(rel: string): string {
    return this.rootRel ? `${this.rootRel}/${rel}` : rel;
  }

  private async fence(rel: string, fromCwd = false): Promise<string> {
    check(this.signal);
    if (forbidden(rel) || forbidden(this.hostPath(rel))) {
      return fail('path', 'Sensitive or generated paths are excluded.');
    }
    const path = resolve(fromCwd ? this.cwd : this.root, rel);
    if (isSecretFilePath(path)) return fail('path', 'Sensitive or generated paths are excluded.');
    if (!contains(fromCwd ? this.cwd : this.root, path))
      return fail('path', 'Path escapes the local workspace.');
    // Re-walk cwd → root → target on every access: create() only proved the initial layout.
    if ((await realpath(this.cwd)) !== this.cwd) {
      return fail('path', 'Workspace path changed or escaped.');
    }
    let current = this.cwd;
    for (const part of [
      ...(fromCwd ? [] : this.rootRel.split('/').filter(Boolean)),
      ...rel.split('/').filter(Boolean),
    ]) {
      current = resolve(current, part);
      const info = await lstat(current);
      if (info.isSymbolicLink()) return fail('path', 'Symlinks are excluded from code_search.');
    }
    if ((await realpath(path)) !== path || (await realpath(this.root)) !== this.root) {
      return fail('path', 'Workspace path changed or escaped.');
    }
    return path;
  }

  /** Ancestor rules are ordered parent-first; a child negation can only undo a softer parent rule. */
  private ignored(rel: string, directory = false): boolean {
    const hostRel = this.hostPath(rel);
    if (forbidden(rel) || forbidden(hostRel)) return true;
    let ignored = false;
    for (const rule of this.rules) {
      const r = relative(rule.base, hostRel).split(sep).join('/');
      if (!r || r.startsWith('../')) continue;
      const result = rule.matcher.test(r + (directory ? '/' : ''));
      if (result.ignored) ignored = true;
      else if (result.unignored) ignored = false;
    }
    return ignored;
  }

  private async text(
    rel: string,
    ignoreRules = true,
    reuse = false,
    fromCwd = false,
    final = false,
    stepRemaining = LIMITS.stepReadBytes
  ): Promise<string> {
    if (ignoreRules && this.ignored(rel)) return fail('path', 'Ignored paths are excluded.');
    const path = await this.fence(rel, fromCwd);
    const cached = reuse ? this.textCache.get(rel) : undefined;
    if (cached) {
      const now = await lstat(path);
      if (
        now.isFile() &&
        now.ino === cached.ino &&
        now.dev === cached.dev &&
        now.size === cached.size &&
        now.mtimeMs === cached.mtimeMs &&
        now.ctimeMs === cached.ctimeMs
      ) {
        return cached.text;
      }
      this.textCache.delete(rel);
    }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > LIMITS.fileBytes) {
        return fail('bounds', 'File is not regular text or exceeds 512 KiB.');
      }
      const remaining = final
        ? LIMITS.finalReadBytes - this.finalReadBytes
        : Math.min(LIMITS.totalReadBytes - this.readBytes, stepRemaining);
      if (stat.size > remaining) {
        return fail(
          'bounds',
          final ? 'Final file read budget exceeded.' : 'Total file read budget exceeded.'
        );
      }
      const buffer = Buffer.alloc(Math.min(stat.size + 1, LIMITS.fileBytes + 1, remaining));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (final) this.finalReadBytes += bytesRead;
      else this.readBytes += bytesRead;
      check(this.signal);
      if (bytesRead > LIMITS.fileBytes || (await handle.stat()).size > bytesRead) {
        return fail('bounds', 'File exceeded the byte budget.');
      }
      const now = await lstat(await this.fence(rel, fromCwd));
      if (now.ino !== stat.ino || now.dev !== stat.dev) {
        return fail('path', 'File changed identity during read.');
      }
      const data = buffer.subarray(0, bytesRead);
      if (data.includes(0)) return fail('path', 'Binary files are excluded.');
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(data);
      } catch {
        return fail('path', 'Non-UTF8 files are excluded.');
      }
      // The cumulative physical-read cap also bounds cache memory. Final snippets bypass this cache.
      if (reuse) {
        this.textCache.set(rel, {
          text,
          ino: stat.ino,
          dev: stat.dev,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          ctimeMs: stat.ctimeMs,
        });
      }
      return text;
    } finally {
      await handle.close();
    }
  }

  private async loadRules(base: string, final = false): Promise<void> {
    if (this.loadedRules.has(base)) return;
    try {
      const text = await this.text(
        base ? `${base}/.gitignore` : '.gitignore',
        false,
        false,
        true,
        final
      );
      if (
        text.length > 32_768 ||
        text.split('\n').length > 512 ||
        text.split('\n').some((l) => l.length > 512)
      ) {
        return fail('bounds', 'gitignore exceeds its safety budget.');
      }
      this.rules.push({ base: base || '.', matcher: ignore().add(text) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.loadedRules.add(base);
  }

  /** Load cwd → root → requested directory rules before touching directly requested paths. */
  private async loadAncestors(final = false): Promise<void> {
    await this.loadRules('', final);
    let current = '';
    for (const part of this.rootRel.split('/').filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      let ignored = false;
      for (const rule of this.rules) {
        const r = relative(rule.base, current).split(sep).join('/');
        if (!r || r.startsWith('../')) continue;
        const match = rule.matcher.test(`${r}/`);
        if (match.ignored) ignored = true;
        else if (match.unignored) ignored = false;
      }
      if (ignored) return fail('path', 'Ignored paths are excluded.');
      await this.loadRules(current, final);
    }
  }

  private async prepare(rel: string, final = false): Promise<void> {
    await this.loadAncestors(final);
    let currentHost = this.rootRel;
    let currentRoot = '';
    for (const part of rel.split('/').filter(Boolean)) {
      currentRoot = currentRoot ? `${currentRoot}/${part}` : part;
      currentHost = currentHost ? `${currentHost}/${part}` : part;
      const path = await this.fence(currentRoot);
      const info = await lstat(path);
      if (this.ignored(currentRoot, info.isDirectory())) {
        return fail('path', 'Ignored paths are excluded.');
      }
      if (info.isDirectory()) await this.loadRules(currentHost, final);
    }
  }

  /** Stream only the requested subtree. Per-command limits produce explicit partial results. */
  private async *walk(
    rel: string,
    scan: Scan,
    recursive: boolean,
    directories: boolean,
    maxDepth = 24,
    depth = 0
  ): AsyncGenerator<string> {
    check(this.signal);
    const path = await this.fence(rel);
    const info = await lstat(path);
    if (info.isFile()) {
      if (++scan.files > LIMITS.filesVisited) {
        scan.partial = true;
        return;
      }
      if (!this.visitedPaths.has(rel)) {
        if (this.visited >= LIMITS.totalFilesVisited) {
          scan.partial = true;
          return;
        }
        this.visited++;
        this.visitedPaths.add(rel);
      }
      yield rel;
      return;
    }
    if (!info.isDirectory()) return;
    await this.loadRules(this.hostPath(rel));
    const listing = await this.list(rel, path, scan);
    if (!listing) return;
    for (const entry of listing) {
      check(this.signal);
      if (++scan.entries > LIMITS.entries) {
        scan.partial = true;
        return;
      }
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (this.ignored(next, entry.directory)) continue;
      if (entry.directory) {
        if (directories) yield `${next}/`;
        if (recursive) {
          if (depth >= maxDepth) scan.partial = true;
          else yield* this.walk(next, scan, recursive, directories, maxDepth, depth + 1);
        }
      } else if (entry.file) {
        yield* this.walk(next, scan, recursive, directories, maxDepth, depth);
      }
      if (scan.entries > LIMITS.entries || scan.files > LIMITS.filesVisited) return;
    }
  }

  /** 读取一次目录（跳过符号链接），按名称排序保证结果稳定；总目录项预算耗尽时标 partial 且不缓存残缺列表 */
  private async list(rel: string, path: string, scan: Scan): Promise<Listing[] | undefined> {
    const cached = this.listings.get(rel);
    if (cached) return cached;
    const entries: Listing[] = [];
    const dir = await opendir(path);
    try {
      for await (const entry of dir) {
        check(this.signal);
        if (this.entries >= LIMITS.totalEntries) {
          scan.partial = true;
          return;
        }
        this.entries++;
        if (entry.isSymbolicLink()) continue;
        entries.push({ name: entry.name, directory: entry.isDirectory(), file: entry.isFile() });
      }
    } finally {
      await dir.close().catch(() => {});
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    this.listings.set(rel, entries);
    return entries;
  }

  private observe(range: ObservedRange, readfile: boolean): void {
    let candidate: Observation = { ...range, readfile, order: ++this.observationOrder };
    for (let i = this.observations.length - 1; i >= 0; i--) {
      const old = this.observations[i]!;
      if (
        old.path !== candidate.path ||
        old.start > candidate.end + 1 ||
        candidate.start > old.end + 1
      )
        continue;
      candidate = {
        path: candidate.path,
        start: Math.min(old.start, candidate.start),
        end: Math.max(old.end, candidate.end),
        readfile: old.readfile || candidate.readfile,
        order:
          old.readfile === candidate.readfile
            ? Math.max(old.order, candidate.order)
            : old.readfile
              ? old.order
              : candidate.order,
      };
      this.observations.splice(i, 1);
      i = this.observations.length; // A bridge can now touch an earlier, previously separate range.
    }
    this.observations.push(candidate);
    this.observations.sort((a, b) => Number(b.readfile) - Number(a.readfile) || b.order - a.order);
    this.observations.length = Math.min(this.observations.length, 64);
  }

  /** Trusted generation metadata only: never infer evidence from model text or file contents. */
  observedRanges(): ObservedRange[] {
    const result: ObservedRange[] = [];
    const files = new Map<string, number>();
    for (const { path, start, end } of this.observations) {
      if (result.length >= LIMITS.finalRanges) break;
      if (!files.has(path) && files.size >= LIMITS.finalFiles) continue;
      for (let first = start; first <= end; first += 400) {
        const count = files.get(path) ?? 0;
        if (count >= 4 || result.length >= LIMITS.finalRanges) break;
        files.set(path, count + 1);
        result.push({ path, start: first, end: Math.min(end, first + 399) });
      }
    }
    return result;
  }

  private retain(text: string, delivered: DeliveredLine[] = []): string {
    const truncated = Buffer.byteLength(text) > LIMITS.stepBytes;
    const payloadCap = truncated
      ? Math.max(0, LIMITS.stepBytes - Buffer.byteLength(PARTIAL))
      : LIMITS.stepBytes;
    const cut = Buffer.from(text)
      .subarray(0, payloadCap)
      .toString('utf8')
      .replace(/\uFFFD+$/u, '');
    const output = cut + (truncated ? PARTIAL : '');
    const bytes = Buffer.byteLength(output);
    // 累计外发上限：超出时不回传任何正文，只提示模型用已观察到的区间作答
    if (this.bytes + bytes > LIMITS.totalBytes) {
      this.partial = true;
      return OUTPUT_EXHAUSTED;
    }
    this.bytes += bytes;
    this.partial ||= truncated;
    const returnedBytes = Buffer.byteLength(cut);
    for (const line of delivered) {
      if (line.endByte <= returnedBytes) this.observe(line.range, line.readfile);
    }
    return output;
  }

  async execute(cmd: Command): Promise<string> {
    check(this.signal);
    const rel = this.virtual(cmd.path ?? '/codebase');
    await this.prepare(rel);
    if (cmd.op === 'readfile') {
      if ((await lstat(await this.fence(rel))).isDirectory()) {
        return this.retain(
          'Path is a directory, not a file. Use ls or tree here to discover a file, then readfile on that exact path.'
        );
      }
      const start = cmd.start ?? 1;
      const end = cmd.end ?? start + 199;
      if (end < start || end - start > 399) return fail('bounds', 'Read window exceeds 400 lines.');
      const rows = (await this.text(rel, true, true)).split('\n').slice(start - 1, end);
      let endByte = 0;
      const delivered: DeliveredLine[] = [];
      const output = rows
        .map((line, i) => {
          const rendered = `${start + i}: ${line}`;
          endByte += (i ? 1 : 0) + Buffer.byteLength(rendered);
          delivered.push({
            endByte,
            range: { path: `/codebase/${rel}`, start: start + i, end: start + i },
            readfile: true,
          });
          return rendered;
        })
        .join('\n');
      return this.retain(output, delivered);
    }
    if (cmd.op === 'rg' && !cmd.pattern)
      return fail('bounds', 'Literal rg requires a nonempty pattern.');
    const scan: Scan = { entries: 0, files: 0, partial: false };
    const out: string[] = [];
    const delivered: DeliveredLine[] = [];
    const sources: { file: string; lines: string[]; first: number }[] = [];
    const stdin: string[] = [];
    let inputBytes = 0;
    let globalLine = 1;
    const native = cmd.op === 'rg' && !cmd.literal && /[\\.^$|?*+()[\]{}\r\n]/.test(cmd.pattern!);
    let size = 0;
    const readStart = this.readBytes;
    const append = (line: string, range?: ObservedRange): boolean => {
      const bytes = Buffer.byteLength(line) + 1;
      if (size + bytes > LIMITS.stepBytes - 512) {
        scan.partial = true;
        return false;
      }
      const endByte = size + Buffer.byteLength(line);
      out.push(line);
      if (range) delivered.push({ endByte, range, readfile: false });
      size += bytes;
      return true;
    };
    outer: for await (const file of this.walk(
      rel,
      scan,
      cmd.op !== 'ls',
      cmd.op === 'ls' || cmd.op === 'tree',
      cmd.op === 'tree' ? 2 : 24
    )) {
      if (cmd.op !== 'rg') {
        if (
          (cmd.op !== 'glob' || wildcard(cmd.pattern ?? '*', file)) &&
          !append(`/codebase/${file}`)
        ) {
          break;
        }
        continue;
      }
      if (this.readBytes - readStart >= LIMITS.stepReadBytes) {
        scan.partial = true;
        break;
      }
      let text: string;
      try {
        text = await this.text(
          file,
          true,
          true,
          false,
          false,
          LIMITS.stepReadBytes - (this.readBytes - readStart)
        );
      } catch (error) {
        check(this.signal);
        if (error instanceof Error && error.message.startsWith('Total file read budget')) {
          scan.partial = true;
          break;
        }
        // Skip unusable text, not path-race or cancellation failures.
        if (
          error instanceof Error &&
          /^(File is not regular text|Binary files|Non-UTF8 files)/.test(error.message)
        ) {
          continue;
        }
        throw error;
      }
      const lines = text.split('\n');
      if (native) {
        const normalized = `${text}\n`;
        const bytes = Buffer.byteLength(normalized);
        if (inputBytes + bytes > LIMITS.stepReadBytes) {
          scan.partial = true;
          break;
        }
        sources.push({ file, lines, first: globalLine });
        stdin.push(normalized);
        globalLine += lines.length;
        inputBytes += bytes;
        continue;
      }
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes(cmd.pattern!)) {
          const line = lines[i]!;
          if (
            !append(
              `/codebase/${file}:${i + 1}: ${line.slice(0, 2000)}`,
              line.length <= 2000
                ? { path: `/codebase/${file}`, start: i + 1, end: i + 1 }
                : undefined
            )
          )
            break outer;
        }
      }
    }
    if (native) {
      const result = await matchLines(cmd.pattern!, stdin.join(''), this.signal);
      scan.partial ||= result.partial;
      if (result.notice) append(result.notice);
      let sourceIndex = 0;
      for (const hit of result.lines) {
        while (
          sourceIndex < sources.length &&
          hit >= sources[sourceIndex]!.first + sources[sourceIndex]!.lines.length
        )
          sourceIndex++;
        const source = sources[sourceIndex];
        if (!source || hit < source.first) continue;
        const lineIndex = hit - source.first;
        const line = source.lines[lineIndex]!;
        if (
          !append(
            `/codebase/${source.file}:${lineIndex + 1}: ${line.slice(0, 2000)}`,
            line.length <= 2000
              ? { path: `/codebase/${source.file}`, start: lineIndex + 1, end: lineIndex + 1 }
              : undefined
          )
        )
          break;
      }
    }
    this.partial ||= scan.partial;
    return this.retain(out.join('\n') + (scan.partial ? PARTIAL : ''), delivered);
  }

  async snippet(
    virtual: string,
    start: number,
    end: number
  ): Promise<{ path: string; start: number; end: number; content: string }> {
    const rel = this.virtual(virtual);
    await this.prepare(rel, true);
    check(this.signal);
    if (end < start || start < 1 || end - start > 399) {
      return fail('bounds', 'Answer range exceeds 400 lines.');
    }
    const path = await this.fence(rel);
    // Never reuse the command cache here: the answer must reflect the file at finalization time.
    const lines = (await this.text(rel, true, false, false, true)).split('\n');
    check(this.signal);
    if (end > lines.length) return fail('bounds', 'Answer range exceeds file length.');
    const output = relative(this.cwd, path).split(sep).join('/');
    return {
      path: output,
      start,
      end,
      content: lines
        .slice(start - 1, end)
        .map((l, i) => `${start + i}: ${l}`)
        .join('\n'),
    };
  }
}
