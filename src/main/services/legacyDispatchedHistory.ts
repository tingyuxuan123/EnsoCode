import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/** Exact realpath containment: a replaced journal must never disclose another workspace's files. */
export function resolveLegacyDispatchedHistoryFile(
  sessionDir: string,
  file: string | undefined
): string | null {
  if (!file || !path.isAbsolute(file)) return null;
  try {
    const root = realpathSync(sessionDir);
    const resolved = realpathSync(file);
    const lexicalRoot = path.resolve(sessionDir);
    const lexicalFile = path.resolve(file);
    const relative = lexicalFile.startsWith(`${lexicalRoot}${path.sep}`)
      ? path.relative(lexicalRoot, lexicalFile)
      : path.relative(root, lexicalFile);
    if (
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      resolved !== path.join(root, relative) ||
      !resolved.startsWith(`${root}${path.sep}`) ||
      !statSync(resolved).isFile()
    )
      return null;
    return resolved;
  } catch {
    return null;
  }
}
