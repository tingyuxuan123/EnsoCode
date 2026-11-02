import type { PluginToolDescriptor } from '@shared/extensionPlugins/types';
import type { McpServerSpawnConfig } from '@shared/types/agent';

export interface NativePluginResources {
  tools: PluginToolDescriptor[];
  skillPaths: string[];
  mcpServers: McpServerSpawnConfig[];
  preset?:
    | { ok: true; instruction?: { path: string; content: string }; systemPrompt?: string }
    | { ok: false; error: string };
}
let provider: ((presetId?: string) => NativePluginResources) | undefined;
let loader: (() => Promise<void>) | undefined;
let ready: Promise<void> | undefined;
export function setNativePluginLoader(value: () => Promise<void>): void {
  loader = value;
  ready = undefined;
}
export function ensureNativePluginResources(): Promise<void> {
  if (!ready) ready = loader?.() ?? Promise.resolve();
  return ready;
}
/** Main injects the initialized service; no plugin process is started by reading resources. */
export function setNativePluginResources(
  value: ((presetId?: string) => NativePluginResources) | undefined
): void {
  provider = value;
}
export function nativePluginResources(presetId?: string): NativePluginResources {
  if (provider) return provider(presetId);
  return {
    tools: [],
    skillPaths: [],
    mcpServers: [],
    ...(presetId?.startsWith('plugin:')
      ? { preset: { ok: false as const, error: 'Native plugin service is not ready' } }
      : {}),
  };
}
