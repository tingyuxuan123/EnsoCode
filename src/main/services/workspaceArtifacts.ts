import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectedMessage } from '@shared/types/agent';

const TEXT_CANDIDATE_LIMIT = 64;

const WRITE_TOOLS = new Set(['write', 'edit']);
const DELIMITERS = /[\s`'"<>()[\]{}|,;，。；：、！？（）《》「」“”‘’*]+/u;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/giu;
const FILE_URL_RE = /\bfile:\/\/[^\s`'"<>()[\]]+/giu;
const BARE_FILE_RE = /^[^/]*\p{L}[^/]*\.[A-Za-z0-9]{1,10}$/u;

type ArtifactKind = 'image' | 'markdown' | 'html' | 'pdf' | 'text' | 'other';

const KINDS: Record<string, ArtifactKind> = {};
const register = (kind: ArtifactKind, list: string) => {
  for (const ext of list.split(' ')) KINDS[ext] = kind;
};
register('image', 'png jpg jpeg gif webp svg bmp ico avif');
register('markdown', 'md markdown mdx');
register('html', 'html htm');
register('pdf', 'pdf');
register(
  'text',
  'txt log csv tsv json jsonl yaml yml toml xml ini conf ts tsx js jsx mjs cjs py rb go rs java kt swift c h cpp hpp cs php sh bash zsh sql css scss less vue svelte lua dart diff patch'
);

export function artifactKind(name: string): ArtifactKind {
  const ext = path.extname(name).slice(1).toLowerCase();
  return KINDS[ext] ?? 'other';
}

/** 正文里出现的路径：绝对路径、含目录的相对路径、带扩展名的文件名（是否存在由解析阶段判断） */
export function textPathCandidates(text: string): string[] {
  const urls: string[] = [];
  const cleaned = text
    .replace(FILE_URL_RE, (url: string) => {
      try {
        // Keep decoded whitespace within one candidate; Windows file URLs have a /C:/ prefix,
        // which is not itself a native path. Node also rejects encoded separators and userinfo.
        const parsed = new URL(url);
        const file = fileURLToPath(parsed, { windows: /^\/[A-Za-z]:\//.test(parsed.pathname) });
        return ` \0${urls.push(file) - 1}\0 `;
      } catch {
        return ' ';
      }
    })
    .replace(URL_RE, ' ');
  const out: string[] = [];
  for (const raw of cleaned.split(DELIMITERS)) {
    const urlIndex = /^\0(\d+)\0$/.exec(raw);
    if (urlIndex) {
      const file = urls[Number(urlIndex[1])];
      if (file && !out.includes(file)) out.push(file);
      if (out.length >= TEXT_CANDIDATE_LIMIT) break;
      continue;
    }
    const token = raw.replace(/[.:!?。]+$/u, '').replace(/:\d+(?::\d+)?$/u, '');
    if (!token || token.startsWith('-') || token.startsWith('~')) continue;
    const looksLikePath = token.includes('/') ? /[^/]/u.test(token) : BARE_FILE_RE.test(token);
    if (looksLikePath && !out.includes(token)) out.push(token);
    if (out.length >= TEXT_CANDIDATE_LIMIT) break;
  }
  return out;
}

const pathArg = (args: unknown): string | undefined => {
  if (!args || typeof args !== 'object') return undefined;
  const { path: value, file_path: filePath } = args as Record<string, unknown>;
  const candidate = typeof value === 'string' ? value : filePath;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
};

/** 一轮消息里的候选路径：写文件类工具在前，助手正文里提到的在后 */
export function artifactCandidates(messages: readonly ProjectedMessage[]): string[] {
  const writes: string[] = [];
  const mentioned: string[] = [];
  for (const message of messages) {
    if (message.role === 'toolResult') {
      for (const change of message.fileChanges ?? [])
        if (change.type !== 'delete') writes.push(change.path);
      continue;
    }
    if (message.role !== 'assistant') continue;
    for (const part of message.content) {
      if (part.type === 'toolCall' && WRITE_TOOLS.has(part.name)) {
        const file = pathArg(part.arguments);
        if (file) writes.push(file);
      } else if (part.type === 'text') {
        mentioned.push(...textPathCandidates(part.text));
      }
    }
  }
  return [...new Set([...writes, ...mentioned])];
}

function realRootOf(root: string): string | null {
  try {
    return realpathSync(root);
  } catch {
    return null;
  }
}

function relativeInside(root: string, file: string): string | null {
  const rel = path.relative(root, file);
  return rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
    ? rel
    : null;
}

/** 解析符号链接后必须仍在根内且是普通文件 */
function insideFile(realRoot: string, abs: string): { real: string; size: number } | null {
  try {
    const real = realpathSync(abs);
    if (!relativeInside(realRoot, real)) return null;
    const stat = statSync(real);
    return stat.isFile() ? { real, size: stat.size } : null;
  } catch {
    return null;
  }
}

/** 候选路径 → 位于工作区根内、存在的文件卡片（按真实路径去重，最多 limit 张） */
export function resolveArtifacts(
  root: string,
  candidates: readonly string[],
  limit: number
): { rel: string; kind: ArtifactKind }[] {
  const realRoot = realRootOf(root);
  if (!realRoot) return [];
  const seen = new Set<string>();
  const out: { rel: string; kind: ArtifactKind }[] = [];
  for (const candidate of candidates) {
    if (out.length >= limit) break;
    if (!candidate || candidate.startsWith('~')) continue;
    const file = insideFile(realRoot, path.resolve(root, candidate));
    if (!file || seen.has(file.real)) continue;
    seen.add(file.real);
    const name = path.basename(file.real);
    out.push({
      rel: path.relative(realRoot, file.real),
      kind: artifactKind(name),
    });
  }
  return out;
}

/** 预览 / 打开前的二次校验：只接受根内相对路径，返回真实路径 */
export function resolveArtifactFile(root: string, rel: string): string | null {
  if (!rel || path.isAbsolute(rel)) return null;
  const realRoot = realRootOf(root);
  return realRoot ? (insideFile(realRoot, path.resolve(realRoot, rel))?.real ?? null) : null;
}
