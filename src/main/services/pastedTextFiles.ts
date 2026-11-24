import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PASTED_TEXT_FILE_NAME,
  type PastedTextFileResult,
  pastedTextFileContent,
} from '@shared/pastedText';

const OWNER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** <sessionDir>/pasted-text/<owner>；owner 只认会话 UUID，杜绝路径穿越 */
function ownerDir(sessionDir: string, owner: string): string | undefined {
  if (!OWNER_RE.test(owner)) return undefined;
  const root = path.resolve(sessionDir, 'pasted-text');
  const dir = path.resolve(root, owner);
  return path.dirname(dir) === root ? dir : undefined;
}

/** 每次粘贴一个子目录，文件名固定 pasted-text.txt */
export async function savePastedTextFile(
  sessionDir: string,
  owner: string,
  text: string
): Promise<PastedTextFileResult> {
  const dir = ownerDir(sessionDir, owner);
  if (!dir) return { ok: false, error: 'invalid-owner' };
  const content = pastedTextFileContent(text);
  if (content === null) return { ok: false, error: 'invalid-length' };
  const file = path.join(dir, randomUUID().slice(0, 8), PASTED_TEXT_FILE_NAME);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, { encoding: 'utf8', flag: 'wx' });
  return { ok: true, path: file, chars: content.length, lines: content.split('\n').length };
}

export function removePastedTextFiles(sessionDir: string, owner: string): void {
  const dir = ownerDir(sessionDir, owner);
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}
