import { createHash } from 'node:crypto';
import { constants, realpathSync, type Stats, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import {
  PAIR_FILE_CHUNK_BYTES,
  PAIR_FILE_MAX_BYTES,
  type PairFileEntry,
  type PairFileTarget,
  type PhoneToHost,
} from '@enso/pair';
import { resolveArtifactFile } from './bots/artifacts';
import type { PairReply } from './pairHost';
import { parsePairFileCommand } from './pairPolicy';

export interface PairFileSource {
  root: string;
  artifacts: readonly { rel: string }[];
}
export type PairFileCommand = Extract<PhoneToHost, { type: 'file-list' | 'file-read' }>;
export interface PairFilePort {
  handle(command: PairFileCommand, reply: PairReply): Promise<void>;
  /** Main authorization checked again by the transport immediately before sending. */
  canAccess?(target: PairFileTarget): boolean;
  /** Authority version/root fingerprint, not a wire ID or a disk path from the phone. */
  accessKey?(target: PairFileTarget): string | null;
}

export const PAIR_FILE_LIST_LIMIT = 128;
type Lookup = (target: PairFileTarget) => Promise<PairFileSource | null>;
interface ResolvedFile {
  entry: PairFileEntry;
  root: string;
  file: string;
}

function fileId(target: PairFileTarget, root: string, rel: string, info: Stats): string {
  return createHash('sha256')
    .update(
      JSON.stringify([target, root, rel, info.size, info.mtimeMs, info.ctimeMs, info.dev, info.ino])
    )
    .digest('hex');
}

/** This only stats authorized artifacts, never reads workspace content or accepts wire paths. */
function filesOf(target: PairFileTarget, source: PairFileSource): ResolvedFile[] {
  const root = realpathSync(source.root);
  const seen = new Set<string>();
  const files: ResolvedFile[] = [];
  for (const artifact of source.artifacts.slice(0, PAIR_FILE_LIST_LIMIT)) {
    const rel = artifact.rel;
    if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).some((part) => part === '..')) continue;
    const file = resolveArtifactFile(root, rel);
    if (!file || seen.has(file)) continue;
    const info = statSync(file);
    if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 0) continue;
    seen.add(file);
    files.push({
      root,
      file,
      entry: {
        id: fileId(target, root, rel, info),
        rel,
        name: path.basename(file),
        size: info.size,
      },
    });
  }
  return files;
}

async function readChunk(
  lookup: Lookup,
  command: Extract<PairFileCommand, { type: 'file-read' }>,
  source: PairFileSource
) {
  const found = filesOf(command.target, source).find((file) => file.entry.id === command.fileId);
  if (!found) return { error: 'not-found' };
  const { entry, root, file } = found;
  if (entry.size > PAIR_FILE_MAX_BYTES) return { error: 'too-large' };
  if (command.offset > entry.size) return { error: 'invalid' };
  // O_NOFOLLOW rejects replacement symlinks; NONBLOCK avoids hanging on a replacement FIFO.
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      fileId(command.target, root, entry.rel, before) !== entry.id ||
      realpathSync(source.root) !== root ||
      resolveArtifactFile(root, entry.rel) !== file
    )
      return { error: 'changed' };
    const buffer = Buffer.alloc(Math.min(PAIR_FILE_CHUNK_BYTES, entry.size - command.offset));
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const read = await handle.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        command.offset + bytesRead
      );
      if (!read.bytesRead) return { error: 'changed' };
      bytesRead += read.bytesRead;
    }
    const after = await handle.stat();
    if (fileId(command.target, root, entry.rel, after) !== entry.id) return { error: 'changed' };
    // Ownership, root, mention set and path version can change while disk I/O is pending.
    const current = await lookup(command.target);
    if (!current) return { error: 'unavailable' };
    if (!filesOf(command.target, current).some((item) => item.entry.id === entry.id))
      return { error: 'changed' };
    return {
      name: entry.name,
      size: entry.size,
      offset: command.offset,
      data: buffer.toString('base64'),
    };
  } finally {
    await handle.close();
  }
}

export function createPairFilePort(lookup: Lookup): PairFilePort {
  return {
    async handle(command: PairFileCommand, reply: PairReply): Promise<void> {
      const base = { requestId: command.requestId };
      let result: Awaited<ReturnType<typeof readChunk>> = { error: 'unavailable' };
      let files: PairFileEntry[] = [];
      let error: string | undefined;
      try {
        const parsed = parsePairFileCommand(command);
        if (!parsed) error = 'invalid';
        else {
          const source = await lookup(parsed.target);
          if (!source) error = 'unavailable';
          else if (parsed.type === 'file-list')
            files = filesOf(parsed.target, source).map((file) => file.entry);
          else result = await readChunk(lookup, parsed, source);
        }
      } catch {
        error = 'unavailable';
      }
      // One pull request = one bounded reply. A failed connection never starts another chunk.
      await reply(
        command.type === 'file-list'
          ? { type: 'file-list-result', ...base, files, ...(error ? { error } : {}) }
          : { type: 'file-read-result', ...base, ...result, ...(error ? { error } : {}) }
      );
    },
  };
}
