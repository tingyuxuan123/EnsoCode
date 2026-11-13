import type { PluginStatusItem, StatusTone } from '@shared/extensionPlugins/statusItems';
import type { ExtensionPluginSummary } from '@shared/extensionPlugins/types';
import { useSyncExternalStore } from 'react';
import { addToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { pluginCommands, runPluginCommand } from './commands';
export interface PluginStatusRef extends PluginStatusItem {
  pluginId: string;
  pluginName: string;
}
export function pluginStatusRefs(list: readonly ExtensionPluginSummary[]): PluginStatusRef[] {
  return list
    .filter((plugin) => plugin.state === 'enabled')
    .flatMap((plugin) =>
      (plugin.statusItems ?? [])
        .filter((item) => item.visible && item.text.trim())
        .map((item) => ({ ...item, pluginId: plugin.id, pluginName: plugin.name }))
    );
}
let items: PluginStatusRef[] = [];
const listeners = new Set<() => void>();
export function setPluginStatusItems(next: PluginStatusRef[]) {
  items = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => items;
const TONE: Record<StatusTone, string> = {
  neutral: 'text-muted-foreground',
  accent: 'text-primary',
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-red-600 dark:text-red-400',
};
export function PluginStatusItems({ sessionId }: { sessionId: string | null }) {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <>
      {list.map((item) => {
        const command = item.command
          ? pluginCommands().find((c) => c.pluginId === item.pluginId && c.id === item.command)
          : undefined;
        const className = cn('shrink-0 truncate px-1 text-[11px]', TONE[item.tone]);
        const title = item.tooltip ? `${item.tooltip} · ${item.pluginName}` : item.pluginName;
        return command ? (
          <button
            key={`${item.pluginId}:${item.id}`}
            type="button"
            title={title}
            className={cn(className, 'rounded hover:bg-accent')}
            onClick={() =>
              void runPluginCommand(command, sessionId).then((error) => {
                if (error) addToast({ title: error });
              })
            }
          >
            {item.text}
          </button>
        ) : (
          <span key={`${item.pluginId}:${item.id}`} title={title} className={className}>
            {item.text}
          </span>
        );
      })}
    </>
  );
}
