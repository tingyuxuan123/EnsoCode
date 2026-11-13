import { useSyncExternalStore } from 'react';
export interface PluginFileViewerRef {
  build?: string;
  pluginId: string;
  pluginName: string;
  id: string;
  title: string;
  entry: string;
  extensions: string[];
  default: boolean;
}
export function pluginFileViewersFor(
  rel: string,
  viewers: readonly PluginFileViewerRef[]
): PluginFileViewerRef[] {
  const name = (rel.split('/').at(-1) ?? '').toLowerCase();
  return viewers
    .map((viewer) => ({
      viewer,
      length: Math.max(
        0,
        ...viewer.extensions.map((ext) =>
          name.length > ext.length && name.endsWith(ext.toLowerCase()) ? ext.length : 0
        )
      ),
    }))
    .filter((item) => item.length > 0)
    .sort((a, b) => b.length - a.length)
    .map((item) => item.viewer);
}
export const fileViewerKey = (viewer: { pluginId: string; id: string }) =>
  `${viewer.pluginId}:${viewer.id}`;
let viewers: PluginFileViewerRef[] = [];
const listeners = new Set<() => void>();
export function setPluginFileViewers(next: PluginFileViewerRef[]): void {
  viewers = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => viewers;
export const usePluginFileViewers = () => useSyncExternalStore(subscribe, snapshot, snapshot);
