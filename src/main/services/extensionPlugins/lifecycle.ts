import type { PluginGrant } from '@shared/extensionPlugins/grant';

export const PLUGIN_STATES = ['disabled', 'enabled', 'crashed'] as const;
export type PluginState = (typeof PLUGIN_STATES)[number];
export interface PluginRecord {
  id: string;
  version: string;
  dir: string;
  state: PluginState;
  grant: PluginGrant;
  installedAt: number;
  pending?: { version: string; dir: string; grant: PluginGrant };
}
export type PluginAction =
  | { type: 'enable' }
  | { type: 'disable' }
  | { type: 'crash' }
  | { type: 'update'; version: string; dir: string; grant: PluginGrant; expands: boolean }
  | { type: 'approve-pending' }
  | { type: 'reject-pending' };

export function applyPluginAction(
  record: PluginRecord,
  action: PluginAction
): PluginRecord | { error: string } {
  switch (action.type) {
    case 'enable':
      return record.state === 'enabled' ? record : { ...record, state: 'enabled' };
    case 'disable':
      return { ...record, state: 'disabled' };
    case 'crash':
      return record.state === 'enabled' ? { ...record, state: 'crashed' } : { error: '插件未启用' };
    case 'update': {
      const { pending: _stale, ...rest } = record;
      const next = { version: action.version, dir: action.dir, grant: action.grant };
      return action.expands ? { ...rest, pending: next } : { ...rest, ...next };
    }
    case 'approve-pending': {
      if (!record.pending) return { error: '没有待授权的更新' };
      const { pending, ...rest } = record;
      return { ...rest, ...pending };
    }
    case 'reject-pending': {
      if (!record.pending) return { error: '没有待授权的更新' };
      const { pending: _rejected, ...rest } = record;
      return rest;
    }
  }
}

export function recordPluginCrash(
  history: readonly number[],
  now: number,
  windowMs = 600_000,
  limit = 3
): { timestamps: number[]; blocked: boolean } {
  if (
    !Number.isFinite(now) ||
    now < 0 ||
    !Number.isFinite(windowMs) ||
    windowMs <= 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 10_000
  )
    throw new Error('崩溃窗口配置不合法');
  const timestamps = [
    ...history.filter((t) => Number.isFinite(t) && t >= 0 && t <= now && now - t < windowMs),
    now,
  ]
    .sort((a, b) => a - b)
    .slice(-limit);
  return { timestamps, blocked: timestamps.length >= limit };
}
