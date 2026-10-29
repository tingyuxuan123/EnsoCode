import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  type CompactReserveTokensReadResult,
  type CompactReserveTokensResult,
  parseCompactReserveTokens,
} from '@shared/compactionSettings';
import lockfile from 'proper-lockfile';

type Settings = Record<string, unknown>;
const isRecord = (value: unknown): value is Settings =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasCode = (error: unknown, code: string): boolean => isRecord(error) && error.code === code;

class InvalidSettings extends Error {}

async function readSettings(file: string): Promise<Settings> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return {};
    throw error;
  }
  let settings: unknown;
  try {
    settings = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new InvalidSettings();
  }
  if (
    !isRecord(settings) ||
    (settings.compaction !== undefined && !isRecord(settings.compaction))
  ) {
    throw new InvalidSettings();
  }
  return settings;
}

export async function readCompactReserveTokens(
  file: string
): Promise<CompactReserveTokensReadResult> {
  try {
    const settings = await readSettings(file);
    const value = isRecord(settings.compaction) ? settings.compaction.reserveTokens : undefined;
    return {
      ok: true,
      value: typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null,
    };
  } catch (error) {
    return { ok: false, error: error instanceof InvalidSettings ? 'invalid-file' : 'io-error' };
  }
}

/** 与 pi 复用同一个锁协议和 10s 过期规则，但所有等待与 IO 都是异步的。 */
async function acquireLock(file: string) {
  let compromised: Error | undefined;
  try {
    const release = await lockfile.lock(file, {
      realpath: false,
      stale: 10_000,
      retries: { retries: 9, minTimeout: 20, maxTimeout: 20, factor: 1 },
      onCompromised: (error) => {
        compromised = error;
      },
    });
    return {
      release,
      assertOwned: () => {
        if (compromised) throw compromised;
      },
    };
  } catch (error) {
    if (hasCode(error, 'ELOCKED')) return undefined;
    throw error;
  }
}

export async function writeCompactReserveTokens(
  file: string,
  value: unknown
): Promise<CompactReserveTokensResult> {
  const reserveTokens = parseCompactReserveTokens(value);
  if (reserveTokens === undefined) return { ok: false, error: 'invalid-value' };
  try {
    await mkdir(dirname(file), { recursive: true });
    const lock = await acquireLock(file);
    if (!lock) return { ok: false, error: 'locked' };
    let tmp: string | undefined;
    try {
      const settings = await readSettings(file);
      const compaction = isRecord(settings.compaction) ? { ...settings.compaction } : {};
      if (reserveTokens === null) delete compaction.reserveTokens;
      else compaction.reserveTokens = reserveTokens;
      const next: Settings = { ...settings, compaction };
      if (Object.keys(compaction).length === 0) delete next.compaction;
      tmp = `${file}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify(next, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      lock.assertOwned();
      await rename(tmp, file);
      tmp = undefined;
      return { ok: true };
    } finally {
      try {
        if (tmp) await rm(tmp, { force: true });
      } finally {
        try {
          await lock.release();
        } catch {
          // 保留原操作结果：释放失败不应把已提交的数据误报成未保存，也不覆盖原始错误。
          // 崩溃残留目录按 proper-lockfile 的过期规则恢复。
          console.warn('[compaction-settings] Could not release settings lock');
        }
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof InvalidSettings ? 'invalid-file' : 'io-error' };
  }
}
