import type { ExtensionPluginSummary } from '@shared/extensionPlugins/types';
import { useEffect, useState } from 'react';
export type PluginPresetOption = ExtensionPluginSummary['presets'][number] & { pluginName: string };
export function pluginPresetModel(
  presetId: string,
  presets: readonly { id: string; model?: { providerId: string; modelId: string } }[]
): { providerId: string; modelId: string } | null {
  const model = presets.find((preset) => preset.id === presetId)?.model;
  return model?.providerId && model.modelId
    ? { providerId: model.providerId, modelId: model.modelId }
    : null;
}
export function useEnabledPluginPresets(): PluginPresetOption[] {
  const [presets, setPresets] = useState<PluginPresetOption[]>([]);
  useEffect(() => {
    const api = window.electronAPI?.extensionPlugins;
    if (!api) return;
    let generation = 0;
    const load = () => {
      const mine = ++generation;
      setPresets([]);
      void api
        .list()
        .then(({ plugins: list }) => {
          if (mine !== generation) return;
          setPresets(
            list
              .filter((plugin) => plugin.state === 'enabled')
              .flatMap((plugin) =>
                plugin.presets.map((preset) => ({ ...preset, pluginName: plugin.name }))
              )
          );
        })
        .catch(() => {});
    };
    load();
    const unsubscribe = api.onChanged(load);
    return () => {
      generation++;
      unsubscribe();
    };
  }, []);
  return presets;
}
