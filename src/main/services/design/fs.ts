import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  DesignFsEntry,
  DesignFsRequest,
  DesignFsResponse,
  DesignSaveAsRequest,
  DesignSaveAsResponse,
} from '@shared/types/design';
import { type BrowserWindow, dialog } from 'electron';
import { IGNORED_DIR_NAMES } from '../filesWorkspace';
import { DesignServiceError, isErrno, MAX_FILE_BYTES, MAX_LIST_FILES, tooLarge } from './errors';
import { mimeType, readBounded } from './files';
import { resolveDesignRoot } from './roots';
import { checkedPath } from './security';

export async function designFs(request: DesignFsRequest): Promise<DesignFsResponse> {
  const root = (await resolveDesignRoot(request.root)).path;
  return designFsAtRoot(root, request);
}
/** Root-injected entry for temporary-directory tests. */
export async function designFsAtRoot(
  root: string,
  request: DesignFsRequest
): Promise<DesignFsResponse> {
  if (request.op === 'rename') {
    const from = await checkedPath(root, request.from, true);
    const to = await checkedPath(root, request.to, true);
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
    return { ok: true };
  }
  const writing =
    request.op === 'writeFile' || request.op === 'delete' || request.op === 'createDirectory';
  const file = await checkedPath(root, request.rel, writing);
  switch (request.op) {
    case 'writeFile': {
      const bytes = Buffer.from(request.content, request.encoding);
      if (bytes.length > MAX_FILE_BYTES) tooLarge();
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
      return { ok: true };
    }
    case 'createDirectory':
      await mkdir(file, { recursive: true });
      return { ok: true };
    case 'delete':
      await rm(file, { recursive: true, force: true });
      return { ok: true };
    case 'stat': {
      try {
        const info = await stat(file);
        return {
          ok: true,
          stat: { size: info.size, modifiedAt: info.mtimeMs, createdAt: info.birthtimeMs },
        };
      } catch (error) {
        if (isErrno(error, 'ENOENT')) return { ok: true, stat: null };
        throw error;
      }
    }
    case 'readFile': {
      const bytes = await readBounded(file);
      try {
        return {
          ok: true,
          content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
          encoding: 'utf8',
        };
      } catch {
        return { ok: true, content: bytes.toString('base64'), encoding: 'base64' };
      }
    }
    case 'readBinaryFile': {
      const bytes = await readBounded(file);
      return {
        ok: true,
        data: bytes.toString('base64'),
        mimeType: mimeType(file),
        size: bytes.length,
      };
    }
    case 'readDir': {
      const entries: DesignFsEntry[] = [];
      const children = await readdir(file, { withFileTypes: true });
      if (children.length > MAX_LIST_FILES) tooLarge();
      for (const child of children) {
        const rel = path.posix.join(request.rel, child.name);
        try {
          const target = await checkedPath(root, rel);
          const info = await stat(target);
          entries.push({
            name: child.name,
            rel,
            isDirectory: info.isDirectory(),
            size: info.size,
            modifiedAt: info.mtimeMs,
          });
        } catch (error) {
          if (!(error instanceof DesignServiceError) && !isErrno(error, 'ENOENT')) throw error;
        }
      }
      return { ok: true, entries: entries.sort((a, b) => a.name.localeCompare(b.name)) };
    }
    case 'listFilesRecursive': {
      const files: Array<{ name: string; rel: string }> = [];
      const ignored = new Set([...IGNORED_DIR_NAMES, ...(request.ignoredDirectories ?? [])]);
      const names = request.names ? new Set(request.names) : null;
      let visited = 0;
      const walk = async (dir: string, rel: string) => {
        for (const child of await readdir(dir, { withFileTypes: true })) {
          if (child.name.startsWith('.') || child.isSymbolicLink()) continue;
          if (++visited > 100000) tooLarge();
          const next = path.posix.join(rel, child.name);
          const target = await checkedPath(root, next);
          if (child.isDirectory()) {
            if (!ignored.has(child.name)) await walk(target, next);
          } else if (child.isFile() && (!names || names.has(child.name))) {
            if (files.length >= MAX_LIST_FILES) tooLarge();
            files.push({ name: child.name, rel: next });
          }
        }
      };
      await walk(file, request.rel);
      return { ok: true, files };
    }
  }
}
export async function designSaveAs(
  owner: BrowserWindow,
  request: DesignSaveAsRequest
): Promise<DesignSaveAsResponse> {
  const bytes = Buffer.from(request.content, request.encoding);
  if (bytes.length > MAX_FILE_BYTES) tooLarge();
  const result = await dialog.showSaveDialog(owner, {
    defaultPath: request.defaultFileName,
    title: request.title,
    filters: request.filters,
  });
  if (result.canceled || !result.filePath) return { ok: true, path: null };
  // The selected absolute path is never accepted back as authority by a later IPC request.
  await writeFile(result.filePath, bytes);
  return { ok: true, path: result.filePath };
}
