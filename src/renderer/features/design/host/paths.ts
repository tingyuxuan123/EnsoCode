import { validateDesignAbsolutePath } from '@shared/design/paths';
import type { DesignRootInfo, DesignRootRef } from '@shared/types/design';

const prefix = (path: string) => (path.endsWith('/') ? path : `${path}/`);

/** Renderer-side early guard; Main still validates realpaths and write boundaries. */
export class DesignPaths {
  private roots = new Map<string, DesignRootInfo>();

  remember(info: DesignRootInfo): void {
    const path = validateDesignAbsolutePath(info.path);
    const key = JSON.stringify(info.ref);
    // Bot members and successive group sessions can share a path. An older
    // session may already have ended, even though the shared directory remains.
    this.roots.delete(key);
    this.roots.set(key, { ...info, path });
  }

  map(path: string): { root: DesignRootRef; rel: string } {
    const normalized = validateDesignAbsolutePath(path);
    const root = [...this.roots.values()]
      .reverse()
      .sort((a, b) => b.path.length - a.path.length)
      .find(
        (candidate) =>
          normalized === candidate.path || normalized.startsWith(prefix(candidate.path))
      );
    if (!root) throw new Error(`Design path is outside all authoritative roots: ${path}`);
    return {
      root: root.ref,
      rel: normalized === root.path ? '' : normalized.slice(prefix(root.path).length),
    };
  }
}

export const designPaths = new DesignPaths();

export async function resolveDesignRoot(ref: DesignRootRef): Promise<DesignRootInfo> {
  const result = await window.electronAPI.design.resolveRoot(ref);
  if (!result.ok) throw new Error(result.error);
  designPaths.remember(result.root);
  return result.root;
}
