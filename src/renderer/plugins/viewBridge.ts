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
export interface PluginViewRef {
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
