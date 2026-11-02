import { create } from 'zustand';
import type {
  PluginAgentToolRegistration,
  PluginCodingAgentHookRegistration,
  PluginSystemPromptProviderRegistration,
} from '../vetta/sdk/agent';
import type { Disposable } from '../vetta/sdk/disposable';

export interface DesignContribution {
  kind: string;
  value: unknown;
}
interface DesignRegistryState {
  contributions: DesignContribution[];
  ui: Record<string, unknown>;
}
/** Runtime-only contributions; P2/P3 consume this store without changing activation. */
export const useDesignRegistry = create<DesignRegistryState>(() => ({ contributions: [], ui: {} }));
export const designTools = new Map<string, PluginAgentToolRegistration<any>>();
export const designHooks = new Map<string, PluginCodingAgentHookRegistration<any>>();
export const designPromptProviders = new Map<string, PluginSystemPromptProviderRegistration>();

export function registerContribution(kind: string, value: unknown): Disposable {
  const entry = { kind, value };
  useDesignRegistry.setState((state) => ({ contributions: [...state.contributions, entry] }));
  return {
    dispose: () =>
      useDesignRegistry.setState((state) => ({
        contributions: state.contributions.filter((item) => item !== entry),
      })),
  };
}
export function updateDesignUi(key: string, value: unknown): void {
  useDesignRegistry.setState((state) => ({ ui: { ...state.ui, [key]: value } }));
}
export function registerInMap<T>(map: Map<string, T>, id: string, value: T): Disposable {
  if (map.has(id)) throw new Error(`Duplicate design contribution: ${id}`);
  map.set(id, value);
  return {
    dispose: () => {
      if (map.get(id) === value) map.delete(id);
    },
  };
}
