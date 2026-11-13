import { useSyncExternalStore } from 'react';

export type ViewReply =
  | { id: string | number; ok: true; value: unknown }
  | { id: string | number; ok: false; error: string };
export function createViewBridge(
  call: (method: string, args: unknown, gesture: boolean) => Promise<unknown>,
  userActivation = () => false
): (data: unknown) => Promise<ViewReply | null> {
  return async (data) => {
    if (typeof data !== 'object' || data === null) return null;
    const { id, method, args } = data as Record<string, unknown>;
    if (
      (typeof id !== 'string' && (typeof id !== 'number' || !Number.isSafeInteger(id))) ||
      typeof method !== 'string' ||
      !method ||
      method.length > 128
    )
      return null;
    try {
      return { id, ok: true, value: await call(method, args ?? null, userActivation()) };
    } catch (error) {
      return { id, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}
export function validViewInit(
  event: { source: unknown; data: unknown; ports?: readonly unknown[] },
  parent: unknown,
  nonce: string
): boolean {
  const data = event.data;
  return (
    event.source === parent &&
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    data.type === 'enso-view-init' &&
    'nonce' in data &&
    data.nonce === nonce &&
    'html' in data &&
    typeof data.html === 'string' &&
    event.ports?.length === 1
  );
}
export function decodeUtf8Base64(base64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
}
export function viewStoragePatch(data: unknown): Record<string, string | null> | null {
  if (
    !data ||
    typeof data !== 'object' ||
    !('type' in data) ||
    data.type !== 'enso-storage' ||
    !('patch' in data) ||
    !data.patch ||
    typeof data.patch !== 'object' ||
    Array.isArray(data.patch)
  )
    return null;
  const entries = Object.entries(data.patch);
  if (entries.length > 256) return null;
  let size = 0;
  for (const [key, value] of entries) {
    if (
      !key ||
      key.length > 256 ||
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      (value !== null && typeof value !== 'string')
    )
      return null;
    size += new TextEncoder().encode(key + (value ?? '')).length;
    if (size > 128 * 1024) return null;
  }
  return Object.fromEntries(entries);
}
export const viewThemePush = (theme: 'light' | 'dark') => ({ type: 'enso-theme' as const, theme });
export const viewEventPush = (name: string, data: unknown) => ({
  type: 'enso-view-event' as const,
  name,
  data,
});
export const viewFilePush = (rel: string, text: string) => ({
  type: 'enso-file' as const,
  rel,
  text,
});
export function viewFileEdit(data: unknown): string | null {
  if (
    !data ||
    typeof data !== 'object' ||
    !('type' in data) ||
    data.type !== 'enso-file-edit' ||
    !('text' in data) ||
    typeof data.text !== 'string'
  )
    return null;
  return new TextEncoder().encode(data.text).length <= 2 * 1024 * 1024 ? data.text : null;
}
export interface PluginViewRef {
  build?: string;
  pluginId: string;
  pluginName: string;
  id: string;
  title: string;
  entry: string;
}
let views: PluginViewRef[] = [];
const listeners = new Set<() => void>();
export function setPluginViews(next: PluginViewRef[]): void {
  views = next;
  for (const listener of listeners) listener();
}
const snapshot = () => views;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function usePluginViews(): PluginViewRef[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
