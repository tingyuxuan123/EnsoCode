import type { ExtensionPluginSummary } from '@shared/extensionPlugins/types';
import type { SlashCommand } from '@shared/types/agent';
import { useSyncExternalStore } from 'react';
import { hasActivePluginGesture } from './userGesture';

export interface PluginCommandRef {
  pluginId: string;
  pluginName: string;
  id: string;
  title: string;
  key?: string;
}
let commands: PluginCommandRef[] = [];
let slash: SlashCommand[] = [];
const listeners = new Set<() => void>();
const slashName = (command: PluginCommandRef) => `/${command.pluginId}:${command.id}`;
export function mergePluginCommands<T extends { id: string }>(
  declared: readonly T[],
  dynamic: readonly T[] | undefined
): T[] {
  const seen = new Set<string>();
  return [...declared, ...(dynamic ?? [])].filter((command) => {
    if (seen.has(command.id)) return false;
    seen.add(command.id);
    return true;
  });
}
export function setPluginCommands(next: PluginCommandRef[]): void {
  commands = next;
  slash = next.map((command) => ({
    name: slashName(command),
    description: `${command.title} · ${command.pluginName}`,
  }));
  for (const listener of listeners) listener();
}
export const pluginSlashCommands = () => slash;
export const pluginCommands = () => commands;
export const pluginCommandFor = (name: string) =>
  commands.find((command) => slashName(command) === name) ?? null;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const usePluginSlashCommands = () =>
  useSyncExternalStore(subscribe, pluginSlashCommands, pluginSlashCommands);
export function pluginCommandRefs(list: readonly ExtensionPluginSummary[]): PluginCommandRef[] {
  return list
    .filter((plugin) => plugin.state === 'enabled')
    .flatMap((plugin) =>
      mergePluginCommands(plugin.commands, plugin.dynamicCommands).map((command) => ({
        pluginId: plugin.id,
        pluginName: plugin.name,
        ...command,
      }))
    );
}
export async function runPluginCommand(
  command: PluginCommandRef,
  sessionId: string | null
): Promise<string | null> {
  if (!commands.some((entry) => entry.pluginId === command.pluginId && entry.id === command.id))
    return 'Plugin command is no longer enabled';
  try {
    const result = await window.electronAPI.extensionPlugins.call({
      pluginId: command.pluginId,
      method: 'command.run',
      payload: { id: command.id },
      sessionId,
      gesture: hasActivePluginGesture(),
    });
    return result.ok ? null : result.error;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
