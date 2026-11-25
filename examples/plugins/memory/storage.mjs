import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyState, validateState } from './domain.mjs';

const MAX_BYTES = 16 * 1024 * 1024;

/** One authoritative transaction file: a deletion and its recovery record commit together. */
export function createStorage(directory) {
  const file = join(directory, 'memory.json');
  let queue = Promise.resolve();
  async function prepare() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('插件数据目录不可为符号链接');
  }
  async function load() {
    await prepare();
    let handle;
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES)
        throw new Error('记忆文件不可为链接，且不得大于 16MB');
      handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size > MAX_BYTES) throw new Error('记忆文件无效');
      return validateState(JSON.parse(await handle.readFile('utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return emptyState();
      throw error;
    } finally {
      await handle?.close();
    }
  }
  async function transaction(change) {
    const operation = queue.then(async () => {
      const state = await load();
      const result = await change(state);
      state.revision += 1;
      validateState(state);
      const text = JSON.stringify(state, null, 2);
      if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('记忆容量已达 16MB，请先导出并整理');
      const temporary = join(directory, `.memory-${randomUUID()}.tmp`);
      let handle;
      try {
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(text, 'utf8');
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(temporary, file);
      } finally {
        await handle?.close();
        await rm(temporary, { force: true });
      }
      return result;
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return {
    load: async () => {
      await queue;
      return load();
    },
    transaction,
  };
}
