import type { ComputerAppIdentity } from './types';

/** Opaque identity key, bound to both bundle and Main's canonical path. */
export function appIdentityKey(app: Pick<ComputerAppIdentity, 'bundleId' | 'path'>): string {
  return JSON.stringify([app.bundleId, app.path]);
}
