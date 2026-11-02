import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import type { DesignStorageRequest, DesignStorageResponse } from '@shared/types/design';
import { DesignServiceError, isErrno, MAX_FILE_BYTES, record, tooLarge } from './errors';
import { readBounded } from './files';
import { checkedPath, isStoragePath } from './security';

interface Snapshot {
  revision: string;
  files: Record<string, string>;
}
const locks = new Map<string, Promise<unknown>>();
/** One atomically replaced snapshot is the commit point: no mixed-revision multi-file reads. */
export class DesignStorage {
  constructor(private readonly dir: string) {}
  request(request: DesignStorageRequest): Promise<DesignStorageResponse> {
    const previous = locks.get(this.dir) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.perform(request));
    locks.set(this.dir, next);
    void next
      .finally(() => {
        if (locks.get(this.dir) === next) locks.delete(this.dir);
      })
      .catch(() => {});
    return next;
  }
  private async load(): Promise<Snapshot> {
    await mkdir(this.dir, { recursive: true });
    try {
      const value: unknown = JSON.parse(
        (await readBounded(await checkedPath(this.dir, '.snapshot.json'))).toString('utf8')
      );
      if (!record(value) || typeof value.revision !== 'string' || !record(value.files))
        throw new Error('Invalid storage snapshot');
      const files: Record<string, string> = Object.create(null);
      for (const [key, data] of Object.entries(value.files)) {
        if (!isStoragePath(key) || typeof data !== 'string')
          throw new Error('Invalid storage file');
        files[key] = data;
      }
      return { revision: value.revision, files };
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return { revision: '0', files: Object.create(null) };
      throw error;
    }
  }
  private async perform(request: DesignStorageRequest): Promise<DesignStorageResponse> {
    const paths =
      request.op === 'commit'
        ? request.changes.map((c) => c.path)
        : request.op === 'readSnapshot'
          ? request.paths
          : request.op === 'readFile'
            ? [request.path]
            : [];
    if (paths.some((p) => !isStoragePath(p)))
      throw new DesignServiceError('INVALID_ARGUMENT', 'Invalid storage relative path');
    const current = await this.load();
    const encode = (p: string, encoding: 'base64' | 'utf8'): string | null =>
      current.files[p] === undefined
        ? null
        : encoding === 'base64'
          ? current.files[p]
          : Buffer.from(current.files[p], 'base64').toString('utf8');
    if (request.op === 'list')
      return {
        ok: true,
        paths: Object.keys(current.files)
          .filter((p) => !request.prefix || p.startsWith(request.prefix))
          .sort(),
      };
    if (request.op === 'readFile')
      return { ok: true, data: encode(request.path, request.encoding) };
    if (request.op === 'readSnapshot')
      return {
        ok: true,
        revision: current.revision,
        files: Object.fromEntries(request.paths.map((p) => [p, encode(p, request.encoding)])),
      };
    if (request.expectedRevision !== undefined && request.expectedRevision !== current.revision)
      throw new DesignServiceError('FAILED', 'REVISION_CONFLICT: storage changed since snapshot');
    const files: Record<string, string> = Object.assign(Object.create(null), current.files);
    for (const change of request.changes) {
      if (change.type === 'remove') delete files[change.path];
      else {
        const bytes = Buffer.from(change.data, change.encoding);
        if (bytes.length > MAX_FILE_BYTES) tooLarge();
        files[change.path] = bytes.toString('base64');
      }
    }
    const revision = randomUUID();
    const json = JSON.stringify({ revision, files });
    if (Buffer.byteLength(json) > MAX_FILE_BYTES) tooLarge();
    const temp = await checkedPath(this.dir, `.snapshot-${randomUUID()}.tmp`);
    const destination = await checkedPath(this.dir, '.snapshot.json');
    try {
      await writeFile(temp, json, { flag: 'wx' });
      await rename(temp, destination);
    } finally {
      await rm(temp, { force: true });
    }
    return { ok: true, revision, changedPaths: [...new Set(paths)] };
  }
}
