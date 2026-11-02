import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/** Resolve the executable first: an app-looking symlink must not borrow another app's identity. */
export function canonicalAppPath(executable: string): string | null {
  if (!path.isAbsolute(executable) || hasControlCharacters(executable)) return null;
  try {
    const resolved = realpathSync(executable);
    if (!statSync(resolved).isFile()) return null;
    const bundle = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/iu.exec(resolved)?.[1];
    if (!bundle) return resolved;
    const canonical = realpathSync(bundle);
    return statSync(canonical).isDirectory() ? canonical : null;
  } catch {
    return null;
  }
}

/** Control characters never belong in a canonical identity path. */
function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
