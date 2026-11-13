export interface RendererPluginSource {
  id: string;
  version: string;
  build: string;
  state: string;
  renderer?: string;
  permissions: readonly string[];
}
export interface LoadedPluginRenderer {
  key: string;
  dispose(): void;
}
export function rendererPluginKey(plugin: RendererPluginSource): string {
  return `${plugin.id}\0${plugin.version}\0${plugin.build}\0${plugin.renderer ?? ''}\0${plugin.permissions.includes('composer.draft') ? '1' : '0'}`;
}
export function disposePluginRenderer(id: string, handle: { dispose(): void } | undefined): void {
  try {
    handle?.dispose();
  } catch (error) {
    console.warn(`[plugin] ${id} cleanup failed`, error);
  }
}
export async function syncPluginRenderers(
  loaded: Map<string, LoadedPluginRenderer>,
  plugins: readonly RendererPluginSource[],
  load: (plugin: RendererPluginSource & { renderer: string }) => Promise<{ dispose(): void }>,
  isCurrent: () => boolean
): Promise<void> {
  if (!isCurrent()) return;
  const desired = new Map<string, RendererPluginSource & { renderer: string }>();
  for (const plugin of plugins)
    if (plugin.state === 'enabled' && plugin.renderer)
      desired.set(plugin.id, { ...plugin, renderer: plugin.renderer });
  for (const [id, handle] of loaded) {
    const next = desired.get(id);
    if (!next || rendererPluginKey(next) !== handle.key) {
      disposePluginRenderer(id, handle);
      loaded.delete(id);
    }
  }
  await Promise.allSettled(
    [...desired.values()]
      .filter((plugin) => !loaded.has(plugin.id))
      .map(async (plugin) => {
        if (!isCurrent()) return;
        try {
          const handle = await load(plugin);
          if (!isCurrent()) {
            disposePluginRenderer(plugin.id, handle);
            return;
          }
          const key = rendererPluginKey(plugin);
          const existing = loaded.get(plugin.id);
          if (existing?.key === key) {
            disposePluginRenderer(plugin.id, handle);
            return;
          }
          disposePluginRenderer(plugin.id, existing);
          loaded.set(plugin.id, { key, dispose: () => handle.dispose() });
        } catch (error) {
          if (isCurrent()) console.warn(`[plugin] ${plugin.id} renderer failed`, error);
        }
      })
  );
}
