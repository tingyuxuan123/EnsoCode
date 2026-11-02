import { lstatSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { conversationCwd } from '@shared/conversationCwd';

/** root is Main's canonical scratch project path, never a renderer-supplied path. */
export function resolveScratchWorkspace(
  root: string,
  conversationId: string,
  options: { create?: boolean } = {}
): string | null {
  const cwd = conversationCwd({ kind: 'scratch', canonicalPath: root, conversationId });
  if (!cwd || !path.isAbsolute(root)) return null;
  try {
    const canonicalRoot = realpathSync(root);
    if (canonicalRoot !== path.resolve(root) || !lstatSync(root).isDirectory()) return null;
    if (path.relative(canonicalRoot, cwd) !== conversationId) return null;
    if (options.create) mkdirSync(cwd, { recursive: true });
    // Exact physical child, not a symlink to a sibling (even one inside scratch).
    if (!lstatSync(cwd).isDirectory() || realpathSync(cwd) !== cwd) return null;
    return cwd;
  } catch {
    return null;
  }
}

export function removeScratchWorkspace(root: string, conversationId: string): void {
  const cwd = resolveScratchWorkspace(root, conversationId);
  if (!cwd) return;
  try {
    rmSync(cwd, { recursive: true, force: true });
  } catch {}
}
