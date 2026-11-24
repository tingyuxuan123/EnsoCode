import { createHash, createHmac, randomBytes } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { access, type FileHandle, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileOpenViewer } from '@shared/fileOpening';
import { classifyFileReference, externalCitationPath } from '@shared/markdownLinks';
import type {
  OpenFileCitationRequest,
  OpenFileCitationResult,
  SaveFileCitationRequest,
  SaveFileCitationResult,
} from '@shared/types';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { parsePiHistoryBranch } from './childHistory';
import { EDITOR_MAX_BYTES } from './filesWorkspace';

const MAX_HISTORY_BYTES = 32 * 1024 * 1024;
const markdown = unified().use(remarkParse).use(remarkGfm).freeze();
const safeOpen = (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
const revisionKey = randomBytes(32);
const digest = /^[a-f0-9]{64}$/;

export function parseOpenFileCitationRequest(raw: unknown): OpenFileCitationRequest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (
    Object.keys(raw).some(
      (key) => !['conversationId', 'projectId', 'citationId', 'action'].includes(key)
    )
  )
    return null;
  if (!('conversationId' in raw && 'projectId' in raw && 'citationId' in raw && 'action' in raw))
    return null;
  const { conversationId, projectId, citationId, action } = raw;
  if (
    typeof conversationId !== 'string' ||
    !conversationId ||
    conversationId.length > 256 ||
    typeof projectId !== 'string' ||
    !projectId ||
    projectId.length > 256 ||
    typeof citationId !== 'string' ||
    !digest.test(citationId) ||
    (action !== 'preview' && action !== 'reveal')
  )
    return null;
  return { conversationId, projectId, citationId, action };
}

export function parseSaveFileCitationRequest(raw: unknown): SaveFileCitationRequest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (
    Object.keys(raw).some(
      (key) => !['conversationId', 'projectId', 'citationId', 'revision', 'content'].includes(key)
    )
  )
    return null;
  if (
    !(
      'conversationId' in raw &&
      'projectId' in raw &&
      'citationId' in raw &&
      'revision' in raw &&
      'content' in raw
    )
  )
    return null;
  const { conversationId, projectId, citationId, revision, content } = raw;
  const identity = parseOpenFileCitationRequest({
    conversationId,
    projectId,
    citationId,
    action: 'preview',
  });
  if (
    !identity ||
    typeof revision !== 'string' ||
    !digest.test(revision) ||
    typeof content !== 'string' ||
    content.length > EDITOR_MAX_BYTES ||
    Buffer.byteLength(content) > EDITOR_MAX_BYTES ||
    content.includes('\0')
  )
    return null;
  return {
    conversationId: identity.conversationId,
    projectId: identity.projectId,
    citationId: identity.citationId,
    revision,
    content,
  };
}

function hostPath(value: string): string | null {
  const absolute = externalCitationPath(value);
  if (!absolute || (process.platform === 'win32') !== /^[a-z]:/i.test(absolute)) return null;
  return absolute;
}

function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function statVersion(info: Stats) {
  return [info.dev, info.ino, info.mode, info.nlink, info.size, info.mtimeMs, info.ctimeMs];
}

async function readBytes(fd: FileHandle, info: Stats, limit: number): Promise<Buffer | null> {
  if (!info.isFile() || info.size > limit) return null;
  const bytes = Buffer.alloc(info.size + 1);
  let total = 0;
  while (total < bytes.length) {
    const { bytesRead } = await fd.read(bytes, total, bytes.length - total, total);
    if (!bytesRead) return total === info.size ? bytes.subarray(0, total) : null;
    total += bytesRead;
  }
  return null;
}

async function readBounded(file: string, limit: number, expected?: Stats): Promise<Buffer | null> {
  const fd = await open(file, constants.O_RDONLY | safeOpen);
  try {
    const info = await fd.stat();
    if (expected && !sameFile(expected, info)) return null;
    return await readBytes(fd, info, limit);
  } finally {
    await fd.close();
  }
}

function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    !!relative &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/** Re-derive the path from real Markdown links in the current persisted conversation branch. */
async function resolveCitation(sessionDir: string, sessionFile: string, citationId: string) {
  if (!path.isAbsolute(sessionFile) || path.extname(sessionFile) !== '.jsonl') return null;
  const root = await realpath(sessionDir);
  if (!within(sessionDir, sessionFile) && !within(root, sessionFile)) return null;
  const file = await realpath(sessionFile);
  if (!within(root, file) || path.extname(file) !== '.jsonl') return null;
  const bytes = await readBounded(file, MAX_HISTORY_BYTES);
  if (!bytes) return null;
  const lines = bytes
    .toString('utf8')
    .split('\n')
    .filter((line) => line.trim());
  const records: unknown[] = lines.map((line) => JSON.parse(line));
  const branch = parsePiHistoryBranch(records.shift(), records);
  if (!branch) return null;
  for (const entry of branch.reverse()) {
    if (
      entry.type !== 'message' ||
      entry.message.role !== 'assistant' ||
      !Array.isArray(entry.message.content)
    )
      continue;
    for (const block of entry.message.content) {
      if (block?.type !== 'text' || typeof block.text !== 'string' || !block.text.includes(']'))
        continue;
      const tree = markdown.parse(block.text);
      const definitions = new Map<string, string>();
      visit(tree, 'definition', ({ identifier, url }) => {
        if (!definitions.has(identifier)) definitions.set(identifier, url);
      });
      let found: string | null = null;
      visit(tree, ['link', 'linkReference'], (node) => {
        const url =
          node.type === 'link'
            ? node.url
            : node.type === 'linkReference'
              ? definitions.get(node.identifier)
              : undefined;
        if (!url || found) return;
        const { classification } = classifyFileReference(url);
        if (classification.kind !== 'local') return;
        const candidate = hostPath(classification.path);
        if (candidate && createHash('sha256').update(candidate).digest('hex') === citationId)
          found = candidate;
      });
      if (found) return found;
    }
  }
  return null;
}

interface CiteFileDependencies {
  sessionDir: string;
  sessionFile: string;
  origin: string;
  protectedRoots: string[];
  stillAuthorized: () => boolean;
  reveal: (absolute: string) => void;
}

const protectedName =
  /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.git-credentials|\.git|\.ssh|\.gnupg|\.aws|\.azure|\.kube)$/i;

function protectedPath(file: string, roots: string[]): boolean {
  return (
    file.split('/').some((part) => protectedName.test(part)) ||
    roots.some((root) => path.relative(root, file) === '' || within(root, file))
  );
}

async function citationTarget(citationId: string, deps: CiteFileDependencies) {
  const cited = await resolveCitation(deps.sessionDir, deps.sessionFile, citationId);
  if (!cited) return { ok: false, error: 'citation-unavailable' } as const;
  const absolute = hostPath(await realpath(cited));
  if (!absolute) return { ok: false, error: 'invalid-path' } as const;
  const roots = await Promise.all(
    deps.protectedRoots.map(async (root) => await realpath(root).catch(() => root))
  );
  if (protectedPath(cited, roots) || protectedPath(absolute, roots))
    return { ok: false, error: 'protected-path' } as const;
  return { ok: true, cited, absolute } as const;
}

function editableText(file: string, info: Stats): boolean {
  const viewer = fileOpenViewer(file);
  return (
    info.isFile() && info.size <= EDITOR_MAX_BYTES && (viewer === 'text' || viewer === 'markdown')
  );
}

function fileRevision(
  deps: CiteFileDependencies,
  citationId: string,
  file: string,
  info: Stats,
  bytes: Buffer
): string {
  return createHmac('sha256', revisionKey)
    .update(JSON.stringify([deps.origin, deps.sessionFile, citationId, file, ...statVersion(info)]))
    .update(bytes)
    .digest('hex');
}

export async function openFileCitation(
  request: OpenFileCitationRequest,
  deps: CiteFileDependencies
): Promise<OpenFileCitationResult> {
  try {
    const target = await citationTarget(request.citationId, deps);
    if (!target.ok) return target;
    const { absolute, cited } = target;
    const info = await stat(absolute);
    if (!info.isFile() && !info.isDirectory()) return { ok: false, error: 'unavailable' };
    if (!deps.stillAuthorized()) return { ok: false, error: 'unavailable' };
    if (request.action === 'reveal' || !editableText(absolute, info)) {
      deps.reveal(absolute);
      return { ok: true, target: 'handled' };
    }
    const bytes = await readBounded(absolute, EDITOR_MAX_BYTES, info);
    if (
      !bytes ||
      !deps.stillAuthorized() ||
      hostPath(await realpath(cited)) !== absolute ||
      statVersion(await stat(absolute)).some((value, index) => value !== statVersion(info)[index])
    )
      return { ok: false, error: 'unavailable' };
    const content = bytes.toString('utf8');
    if (bytes.includes(0) || !bytes.equals(Buffer.from(content)))
      return { ok: false, error: 'unsupported-viewer' };
    const writable =
      info.nlink === 1 &&
      (await access(absolute, constants.W_OK).then(
        () => true,
        () => false
      ));
    return {
      ok: true,
      target: 'text',
      citationId: request.citationId,
      path: absolute,
      content,
      ...(writable
        ? { revision: fileRevision(deps, request.citationId, absolute, info, bytes) }
        : {}),
    };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

const saving = new Set<string>();

export async function saveFileCitation(
  request: SaveFileCitationRequest,
  deps: CiteFileDependencies
): Promise<SaveFileCitationResult> {
  try {
    const target = await citationTarget(request.citationId, deps);
    if (!target.ok) return target;
    const { absolute, cited } = target;
    if (!deps.stillAuthorized() || saving.has(absolute)) return { ok: false, error: 'unavailable' };
    saving.add(absolute);
    try {
      // A descriptor opened without truncation both checks and writes the same inode.
      const fd = await open(absolute, constants.O_RDWR | safeOpen);
      try {
        const info = await fd.stat();
        if (!editableText(absolute, info) || info.nlink !== 1)
          return { ok: false, error: 'conflict' };
        const bytes = await readBytes(fd, info, EDITOR_MAX_BYTES);
        const current = await fd.stat();
        if (
          !bytes ||
          fileRevision(deps, request.citationId, absolute, current, bytes) !== request.revision ||
          hostPath(await realpath(cited)) !== absolute ||
          !sameFile(current, await stat(absolute))
        )
          return { ok: false, error: 'conflict' };
        if (!deps.stillAuthorized()) return { ok: false, error: 'unavailable' };
        const next = Buffer.from(request.content);
        // Positional reads did not advance the descriptor. Preserve mode and ownership.
        await fd.writeFile(next);
        await fd.truncate(next.length);
        return {
          ok: true,
          revision: fileRevision(deps, request.citationId, absolute, await fd.stat(), next),
        };
      } finally {
        await fd.close();
      }
    } finally {
      saving.delete(absolute);
    }
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}
