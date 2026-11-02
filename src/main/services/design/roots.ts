import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DesignRootInfo, DesignRootRef } from '@shared/types/design';
import { DesignServiceError } from './errors';
import { checkedPath } from './security';

export async function resolveDesignRoot(ref: DesignRootRef): Promise<DesignRootInfo> {
  // agent imports design's broker; defer this edge until the IPC request, as extensionPlugins does.
  const { pluginProjectRoot, getSourceAuthorityRegistry } = await import('../../ipc/agent');
  const project =
    ref.kind === 'project' ? getSourceAuthorityRegistry()?.project(ref.projectId) : null;
  const root =
    ref.kind === 'session'
      ? pluginProjectRoot(ref.sessionId)
      : project?.state === 'active' && project.kind !== 'ssh'
        ? project.canonicalPath
        : null;
  if (!root)
    throw new DesignServiceError(
      'ROOT_UNAVAILABLE',
      'Local design root unavailable (SSH projects are not supported)'
    );
  try {
    const canonical = await realpath(root);
    if (!(await stat(canonical)).isDirectory()) throw new Error('Not a directory');
    return { ref, path: canonical };
  } catch {
    throw new DesignServiceError('ROOT_UNAVAILABLE', 'Design root is not a local directory');
  }
}
export async function designDirectory(root: DesignRootRef, rel: string): Promise<string> {
  if (rel !== '' && rel !== '.' && !/(?:^|\/)\S[^/]*\.vetd$/.test(rel))
    throw new DesignServiceError('INVALID_ARGUMENT', 'Expected a .vetd design directory');
  const info = await resolveDesignRoot(root);
  const dir = await checkedPath(info.path, rel, rel !== '' && rel !== '.');
  if (!/^[^.].*\.vetd$/.test(path.basename(dir)))
    throw new DesignServiceError('INVALID_ARGUMENT', 'Expected a .vetd design directory');
  if (!(await stat(dir)).isDirectory())
    throw new DesignServiceError('INVALID_ARGUMENT', 'Design is not a directory');
  return dir;
}
