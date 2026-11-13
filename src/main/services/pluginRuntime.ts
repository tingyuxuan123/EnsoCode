import { createHash } from 'node:crypto';
import { isReservedAgentTypeName } from '../../shared/builtinAgents';
import { type AgentTypeEntry, BUILTIN_AGENT_TYPES } from '../../shared/types/assets';
import { isPluginEntry, type PluginEntry } from '../../shared/types/plugins';
import {
  DEFAULT_CLAUDE_PLUGINS_DIR,
  type PluginAgentDef,
  type ResolvedPlugins,
  resolvePluginsForSpawn,
} from './claudePlugins';
import type { ExtensionPluginService, PluginSessionBridge } from './extensionPlugins/service';

export interface NativePluginRuntimeSource {
  get(): Pick<
    ExtensionPluginService,
    | 'presetForSpawn'
    | 'skillPathsForSpawn'
    | 'workflowPathsForSpawn'
    | 'mcpServersForSpawn'
    | 'toolsForSpawn'
    | 'eventPlanForSpawn'
    | 'agentTypesForSpawn'
  >;
  setSessionBridge(bridge: PluginSessionBridge | null): void;
}

let runtimeSource: NativePluginRuntimeSource | null = null;
let sessionBridge: PluginSessionBridge | null = null;

/** Main injects the service without agentHost importing the heavyweight Electron entrypoint. */
export function setNativePluginRuntimeSource(source: NativePluginRuntimeSource | null): void {
  runtimeSource = source;
  source?.setSessionBridge(sessionBridge);
}

export function getNativePluginRuntime(): ReturnType<NativePluginRuntimeSource['get']> | null {
  return runtimeSource?.get() ?? null;
}

export function setNativePluginSessionBridge(bridge: PluginSessionBridge | null): void {
  sessionBridge = bridge;
  runtimeSource?.setSessionBridge(bridge);
}

export type RuntimeAgentType = AgentTypeEntry & { pluginSkillPaths?: string[] };

export interface NativePluginAgentDef extends PluginAgentDef {
  pluginId: string;
  modelMode?: 'agent_pick';
}

export interface PluginAgentTypeDrop {
  name: string;
  source: 'claude' | 'native';
  pluginId?: string;
  shadowedBy: 'custom' | 'builtin' | 'claude' | 'native';
}

export interface NativeAgentTypeSource {
  list(): NativePluginAgentDef[];
  reportDropped?(dropped: PluginAgentTypeDrop[]): void;
}

let nativeSource: NativeAgentTypeSource | null = null;

/** Read at merge time so disabling/uninstalling a plugin immediately removes its types. */
export function setNativeAgentTypeSource(source: NativeAgentTypeSource | null): void {
  nativeSource = source;
}

export function settingsPluginEntries(state: Record<string, unknown> | undefined): PluginEntry[] {
  return Array.isArray(state?.plugins) ? state.plugins.filter(isPluginEntry) : [];
}

export function enabledPlugins(
  state: Record<string, unknown> | undefined,
  pluginsDir = DEFAULT_CLAUDE_PLUGINS_DIR
): ResolvedPlugins {
  return resolvePluginsForSpawn(settingsPluginEntries(state), {
    pluginsDir,
    env: process.env,
  });
}

/** 名字派生的稳定 UUID（v5 位型）：registry 的 custom typeKey 需要 UUID */
export function pluginAgentTypeId(name: string): string {
  const hex = createHash('sha1').update(`enso-plugin-agent:${name}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join('-');
}

const nameKey = (name: string) => name.trim().toLowerCase();

const toRuntime = (agent: PluginAgentDef & { modelMode?: 'agent_pick' }): RuntimeAgentType => ({
  id: pluginAgentTypeId(agent.name),
  name: agent.name,
  description: agent.description || agent.name,
  systemPrompt: agent.systemPrompt,
  tools: agent.tools,
  modelMode: agent.modelMode ?? 'follow',
  pluginSkillPaths: agent.skillPaths,
});

/** 用户自定义 > Claude 插件 > 原生插件；原生插件不能覆盖内置/保留类型名。 */
export function mergePluginAgentTypes(
  custom: readonly AgentTypeEntry[],
  claude: readonly PluginAgentDef[],
  native: readonly NativePluginAgentDef[]
): { types: RuntimeAgentType[]; dropped: PluginAgentTypeDrop[] } {
  const dropped: PluginAgentTypeDrop[] = [];
  const owner = new Map<string, PluginAgentTypeDrop['shadowedBy']>(
    custom.map((entry) => [nameKey(entry.name), 'custom'])
  );
  const claudeTypes = claude.filter((agent) => {
    if (!owner.has(nameKey(agent.name))) return true;
    dropped.push({ name: agent.name, source: 'claude', shadowedBy: 'custom' });
    return false;
  });
  for (const agent of claudeTypes) {
    const key = nameKey(agent.name);
    if (!owner.has(key)) owner.set(key, 'claude');
  }
  const nativeTypes: NativePluginAgentDef[] = [];
  const ordered = [...native].sort((a, b) =>
    a.pluginId < b.pluginId ? -1 : a.pluginId > b.pluginId ? 1 : 0
  );
  for (const agent of ordered) {
    const key = nameKey(agent.name);
    const shadowedBy =
      isReservedAgentTypeName(agent.name) || BUILTIN_AGENT_TYPES.some((b) => b.name === key)
        ? 'builtin'
        : owner.get(key);
    if (shadowedBy) {
      dropped.push({ name: agent.name, source: 'native', pluginId: agent.pluginId, shadowedBy });
      continue;
    }
    owner.set(key, 'native');
    nativeTypes.push(agent);
  }
  return {
    types: [...custom, ...claudeTypes.map(toRuntime), ...nativeTypes.map(toRuntime)],
    dropped,
  };
}

/** 显式传入 native（Bot/remote 传空）时不读取默认来源。 */
export function withPluginAgentTypes(
  custom: readonly AgentTypeEntry[],
  state: Record<string, unknown> | undefined,
  resolved?: ResolvedPlugins,
  native?: readonly NativePluginAgentDef[]
): RuntimeAgentType[] {
  const agents = (resolved ?? enabledPlugins(state)).agents;
  const source = nativeSource;
  const { types, dropped } = mergePluginAgentTypes(custom, agents, native ?? source?.list() ?? []);
  const nativeDropped = dropped.filter((drop) => drop.source === 'native');
  if (nativeDropped.length > 0) source?.reportDropped?.(nativeDropped);
  return types;
}
