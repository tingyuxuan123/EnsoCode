import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { DesignServiceError, isErrno } from './errors';

export function isRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 4096 &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !path.posix.isAbsolute(value) &&
    !/^[a-z]:/i.test(value) &&
    !value.split('/').includes('..')
  );
}
/** Upstream scaffold/import/notes/snapshots/direction/apply all write inside a design package.
 * migrate also uses .vetd.d + .vetd.migrating; gallery writes design-resources/<id>;
 * materials/export-tool writes <design>-frames[-N].pdf or <design>-frames[-N]/*.png.
 */
export function isDesignWritePath(value: string, packageRoot = false): boolean {
  if (!isRelativePath(value)) return false;
  const parts = path.posix.normalize(value).split('/');
  if (parts.length === 1 && parts[0] === '.') return false;
  if (packageRoot) return true;
  const packageIndex = parts.findIndex((p) => /^[^.][^/]*\.vetd(?:\.d)?$/.test(p));
  if (packageIndex >= 0)
    return !parts.slice(0, packageIndex).some((p) => p.startsWith('.') || p === 'node_modules');
  if (parts.some((p) => p.startsWith('.'))) return false;
  if (parts.length === 1 && /^.+\.vetd(?:z|\.migrating)$/.test(parts[0])) return true;
  if (parts[0] === 'design-resources' && parts.length >= 2) return true;
  return parts.length === 1
    ? /^.+-frames(?:-\d+)?(?:\.pdf)?$/.test(parts[0])
    : parts.length === 2 && /^.+-frames(?:-\d+)?$/.test(parts[0]) && /^.+\.png$/i.test(parts[1]);
}
export function contained(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
/** Check the nearest existing ancestor too: a missing leaf must not bypass symlink checks. */
export async function checkedPath(root: string, rel: string, write = false): Promise<string> {
  if (!isRelativePath(rel))
    throw new DesignServiceError('OUT_OF_ROOT', 'Expected a POSIX relative path');
  const canonicalRoot = await realpath(root);
  const packageRoot = /^[^.].*\.vetd(?:\.d)?$/.test(path.basename(canonicalRoot));
  if (write && !isDesignWritePath(rel, packageRoot))
    throw new DesignServiceError('PERMISSION_DENIED', 'Writes are restricted to design artifacts');
  const target = path.resolve(canonicalRoot, rel);
  let ancestor = target;
  for (;;) {
    try {
      await lstat(ancestor);
      break;
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw new DesignServiceError('OUT_OF_ROOT', 'No existing parent');
      ancestor = parent;
    }
  }
  const canonicalParent = await realpath(ancestor);
  if (!contained(canonicalRoot, canonicalParent))
    throw new DesignServiceError('OUT_OF_ROOT', 'Symlink escapes design root');
  // A package symlink to another part of the same project must not grant write access there.
  const canonicalTarget = path.join(canonicalParent, path.relative(ancestor, target));
  if (
    write &&
    !isDesignWritePath(
      path.relative(canonicalRoot, canonicalTarget).split(path.sep).join('/'),
      packageRoot
    )
  )
    throw new DesignServiceError('PERMISSION_DENIED', 'Symlink target is not a design artifact');
  return canonicalTarget;
}
export function isStoragePath(value: unknown): value is string {
  return (
    isRelativePath(value) &&
    value.length > 0 &&
    value
      .split('/')
      .every((p) => p !== '' && p !== '.' && p !== '.storage' && p !== '.snapshot.json')
  );
}
