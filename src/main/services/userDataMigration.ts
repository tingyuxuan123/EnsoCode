import { cpSync, existsSync, renameSync } from 'node:fs';
import path from 'node:path';

/** 旧品牌数据目录。改名后首次启动把它们整体搬到新目录，
 * 否则用户会以为设置、会话历史、凭据全丢了。
 * 只在新目录还不存在时动手：已经有新数据就绝不覆盖。
 */
export const LEGACY_APP_DATA_DIRS = ['enso-code', 'enso-code-dev'] as const;

interface MigrationFs {
  rename?: (from: string, to: string) => void;
  copy?: (from: string, to: string) => void;
}

export type UserDataMigrationResult =
  | { migrated: false; reason: 'target-exists' | 'no-legacy' | 'failed' }
  | { migrated: true; from: string; copied: boolean };

export interface UserDataMigrationInput {
  appData: string;
  target: string;
  legacy?: readonly string[];
  fs?: MigrationFs;
}

export function migrateLegacyUserData({
  appData,
  target,
  legacy = LEGACY_APP_DATA_DIRS,
  fs,
}: UserDataMigrationInput): UserDataMigrationResult {
  const destination = path.join(appData, target);
  if (existsSync(destination)) return { migrated: false, reason: 'target-exists' };

  const source = legacy
    .map((name) => path.join(appData, name))
    .find((candidate) => existsSync(candidate));
  if (!source) return { migrated: false, reason: 'no-legacy' };

  const name = path.basename(source);
  const rename = fs?.rename ?? ((from: string, to: string) => renameSync(from, to));
  try {
    rename(source, destination);
    return { migrated: true, from: name, copied: false };
  } catch {
    // 跨卷、只读挂载或权限不足：退回复制，旧目录留着不删，用户可自行清理。
    const copy = fs?.copy ?? ((from: string, to: string) => cpSync(from, to, { recursive: true }));
    try {
      copy(source, destination);
      return { migrated: true, from: name, copied: true };
    } catch {
      return { migrated: false, reason: 'failed' };
    }
  }
}
