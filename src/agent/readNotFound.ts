/**
 * read 找不到文件时，把 pi 的原始 ENOENT 改写成能让模型一步纠正的错误：
 * 工作区相对路径 + 最近存在目录的条目 + 工作区内同名文件 + 并行竞态提醒。
 * 仍然以异常返回（isError 语义不变）；探测失败或超时一律退回原始错误。
 */

import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import nodePath from 'node:path';
import type { LsOperations } from '@earendil-works/pi-coding-agent';

export type PathKind = 'file' | 'dir' | null;

type PathApi = Pick<
  typeof nodePath,
  'basename' | 'dirname' | 'isAbsolute' | 'join' | 'relative' | 'resolve' | 'sep'
>;

export interface ReadPathProbe {
  /** 不存在（或无法探测）返回 null */
  kind(absolutePath: string): Promise<PathKind>;
  /** 目录条目名；能区分时子目录以 / 结尾 */
  list(absoluteDir: string): Promise<string[]>;
  /** 在 root 下按文件名（大小写不敏感）找文件，返回相对 root 的路径 */
  findByName?(root: string, name: string, limit: number): Promise<string[]>;
}

interface HintOptions {
  cwd: string;
  probe: ReadPathProbe;
  pathApi?: PathApi;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 1500;
const MAX_ANCESTOR_STEPS = 8;
const FULL_LISTING_MAX = 30;
const CLOSEST_LISTING = 15;
const SAME_NAME_SHOWN = 5;
const SAME_NAME_SEARCH_LIMIT = 50;
const NOISE_ENTRIES = new Set(['.DS_Store', '.git/', '.git']);
const REMOTE_NOT_READABLE = /^(.+) is not readable on remote host$/;
const ENOENT_MESSAGE = /^(?:ENOENT|ENOTDIR): [^,]*, \w+ '(.+)'$/;

interface MissingTarget {
  absolutePath: string;
  /** 本地 ENOENT 是确定的“不存在”；远程 test -r 失败也可能是权限问题 */
  definite: boolean;
}

function missingTarget(error: unknown, pathApi: PathApi): MissingTarget | undefined {
  if (!(error instanceof Error)) return undefined;
  const errno = error as NodeJS.ErrnoException;
  if (errno.code === 'ENOENT' || errno.code === 'ENOTDIR') {
    const fromMessage = ENOENT_MESSAGE.exec(error.message)?.[1];
    const absolutePath = typeof errno.path === 'string' ? errno.path : fromMessage;
    return absolutePath && pathApi.isAbsolute(absolutePath)
      ? { absolutePath, definite: true }
      : undefined;
  }
  const remote = REMOTE_NOT_READABLE.exec(error.message)?.[1];
  return remote && pathApi.isAbsolute(remote)
    ? { absolutePath: remote, definite: false }
    : undefined;
}

function inside(pathApi: PathApi, root: string, target: string): string | undefined {
  const relative = pathApi.relative(root, target);
  if (relative.startsWith('..') || pathApi.isAbsolute(relative)) return undefined;
  return relative;
}

function display(pathApi: PathApi, cwd: string, target: string, dir = false): string {
  const relative = inside(pathApi, cwd, target);
  if (relative === undefined) return dir && !target.endsWith(pathApi.sep) ? `${target}/` : target;
  const shown = relative.split(pathApi.sep).join('/');
  if (!dir) return shown;
  return shown ? `${shown}/` : './';
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0] ?? 0;
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j] ?? 0;
      previous[j] = Math.min(
        above + 1,
        (previous[j - 1] ?? 0) + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return previous[b.length] ?? 0;
}

function closeness(entry: string, wanted: string): number {
  const a = entry.replace(/\/$/, '').toLowerCase();
  const b = wanted.toLowerCase();
  if (a === b) return 0;
  if (a.includes(b) || b.includes(a)) return 0.1;
  return editDistance(a, b) / Math.max(a.length, b.length, 1);
}

function describeEntries(entries: string[], wanted: string): string {
  const visible = entries.filter((entry) => !NOISE_ENTRIES.has(entry));
  if (visible.length === 0) return 'it is empty';
  if (visible.length <= FULL_LISTING_MAX) {
    return `entries: ${[...visible].sort((a, b) => a.localeCompare(b)).join(', ')}`;
  }
  const closest = [...visible]
    .sort((a, b) => closeness(a, wanted) - closeness(b, wanted) || a.localeCompare(b))
    .slice(0, CLOSEST_LISTING);
  return `closest of ${visible.length} entries: ${closest.join(', ')} (+${visible.length - closest.length} more)`;
}

function trailingOverlap(candidate: string, wanted: string): number {
  const a = candidate.toLowerCase().split('/').reverse();
  const b = wanted.toLowerCase().split('/').reverse();
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) count++;
  return count;
}

async function nearestDirectory(
  probe: ReadPathProbe,
  pathApi: PathApi,
  start: string
): Promise<string | undefined> {
  let current = start;
  for (let step = 0; step < MAX_ANCESTOR_STEPS; step++) {
    if ((await probe.kind(current)) === 'dir') return current;
    const parent = pathApi.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

async function describeMissing(
  target: MissingTarget,
  cwd: string,
  probe: ReadPathProbe,
  pathApi: PathApi
): Promise<string | undefined> {
  const { absolutePath } = target;
  const shown = display(pathApi, cwd, absolutePath);
  const lines = [`File not found: ${shown}`];
  if ((await probe.kind(absolutePath)) !== null) {
    // 远程 test -r 失败但路径存在：是权限问题，不是找不到
    if (!target.definite) return undefined;
    lines.push(
      'It did not exist when the read ran but exists now (another call in the same batch probably created it). Read it again.'
    );
    return lines.join('\n');
  }

  const parent = pathApi.dirname(absolutePath);
  const nearest = await nearestDirectory(probe, pathApi, parent);
  if (nearest) {
    const remainder = pathApi.relative(nearest, absolutePath).split(pathApi.sep);
    const wanted = remainder[0] ?? pathApi.basename(absolutePath);
    const entries = await probe.list(nearest).catch(() => []);
    const where = display(pathApi, cwd, nearest, true);
    lines.push(
      nearest === parent
        ? `Directory ${where} exists; ${describeEntries(entries, wanted)}.`
        : `Directory ${display(pathApi, cwd, parent, true)} does not exist. Nearest existing directory ${where}; ${describeEntries(entries, wanted)}.`
    );
  }

  const relative = inside(pathApi, cwd, absolutePath);
  if (probe.findByName && relative !== undefined) {
    const wantedPath = relative.split(pathApi.sep).join('/');
    const found = await probe
      .findByName(cwd, pathApi.basename(absolutePath), SAME_NAME_SEARCH_LIMIT)
      .catch(() => []);
    const ranked = found
      .map((candidate) => candidate.split(pathApi.sep).join('/'))
      .filter((candidate) => candidate !== wantedPath)
      .sort(
        (a, b) =>
          trailingOverlap(b, wantedPath) - trailingOverlap(a, wantedPath) || a.length - b.length
      );
    if (ranked.length > 0) {
      const extra =
        ranked.length > SAME_NAME_SHOWN ? ` (+${ranked.length - SAME_NAME_SHOWN} more)` : '';
      lines.push(
        `Same file name in the workspace: ${ranked.slice(0, SAME_NAME_SHOWN).join(', ')}${extra}.`
      );
    }
  }

  lines.push(
    'If another call in the same batch creates this file, read it after that call finishes.'
  );
  return lines.join('\n');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      }
    );
  });
}

export function withReadNotFoundHint<T extends { execute: (...args: never[]) => unknown }>(
  definition: T,
  options: HintOptions
): T {
  const execute = definition.execute as (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown
  ) => unknown;
  const pathApi = options.pathApi ?? nodePath;
  return {
    ...definition,
    execute: (async (
      toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
      onUpdate?: unknown,
      ctx?: unknown
    ) => {
      try {
        return await execute(toolCallId, params, signal, onUpdate, ctx);
      } catch (error) {
        const target = missingTarget(error, pathApi);
        if (!target || signal?.aborted) throw error;
        const ctxCwd = (ctx as { cwd?: unknown } | undefined)?.cwd;
        const cwd = typeof ctxCwd === 'string' && ctxCwd ? ctxCwd : options.cwd;
        const hint = await withTimeout(
          describeMissing(target, cwd, options.probe, pathApi),
          options.timeoutMs ?? DEFAULT_TIMEOUT_MS
        );
        if (!hint) throw error;
        throw new Error(hint, { cause: error });
      }
    }) as T['execute'],
  };
}

async function ripgrepPath(): Promise<string | undefined> {
  try {
    const native = await import('@vscode/ripgrep');
    return native.rgPath.replace(/\.asar([\\/])/, '.asar.unpacked$1');
  } catch {
    return undefined;
  }
}

/** rg --files 遵守 .gitignore（无 git 也生效），按文件名过滤；到量即停 */
async function findByNameWithRipgrep(root: string, name: string, limit: number): Promise<string[]> {
  const rg = await ripgrepPath();
  if (!rg) return [];
  const wanted = name.toLowerCase();
  return new Promise((resolve) => {
    const found: string[] = [];
    let buffer = '';
    let settled = false;
    const child = spawn(
      rg,
      ['--no-config', '--files', '--hidden', '--no-require-git', '--glob', '!.git'],
      { cwd: root, env: {}, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const finish = () => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(found);
    };
    const take = (line: string) => {
      if (line && nodePath.basename(line).toLowerCase() === wanted) found.push(line);
    };
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) take(line);
      if (found.length >= limit) finish();
    });
    child.on('error', finish);
    child.on('close', () => {
      take(buffer);
      finish();
    });
  });
}

export function createLocalReadPathProbe(): ReadPathProbe {
  return {
    kind: async (target) => {
      try {
        return (await stat(target)).isDirectory() ? 'dir' : 'file';
      } catch {
        return null;
      }
    },
    list: async (dir) =>
      (await readdir(dir, { withFileTypes: true })).map((entry) =>
        entry.isDirectory() ? `${entry.name}/` : entry.name
      ),
    findByName: findByNameWithRipgrep,
  };
}

/** 远程：只用 ls 的 stat/readdir（各一次 ssh 往返），不在远端做全量同名搜索 */
export function createRemoteReadPathProbe(ls: LsOperations): ReadPathProbe {
  return {
    kind: async (target) => {
      try {
        return (await ls.stat(target)).isDirectory() ? 'dir' : 'file';
      } catch {
        return null;
      }
    },
    list: (dir) => Promise.resolve(ls.readdir(dir)),
  };
}
