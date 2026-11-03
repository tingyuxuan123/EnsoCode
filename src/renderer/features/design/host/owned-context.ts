import { assertDesignArchivePath } from '@shared/design/archive';
import type { DesignRootInfo, DesignRootRef } from '@shared/types/design';
import type { PluginContext } from './types';

interface OwnerPin {
  root: DesignRootInfo;
  validate(): Promise<void>;
}
const owners = new WeakMap<PluginContext, OwnerPin>();

/** Authority comes from a resolved owner and its live guard, never from the absolute path. */
export function bindDesignContextOwner(ctx: PluginContext, pin: OwnerPin): void {
  owners.set(ctx, pin);
}

export async function ownedDesignContextPath(
  ctx: PluginContext,
  path: string
): Promise<{ root: DesignRootRef; rel: string } | null> {
  const pin = owners.get(ctx);
  if (!pin) return null;
  await pin.validate();
  const base = pin.root.path.replace(/\/$/, '');
  if (path === base) return { root: pin.root.ref, rel: '' };
  if (!path.startsWith(`${base}/`)) throw new Error('Design is outside its pinned owner root');
  const rel = path.slice(base.length + 1);
  assertDesignArchivePath(rel);
  return { root: pin.root.ref, rel };
}
