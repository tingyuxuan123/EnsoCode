import { useSyncExternalStore } from 'react';
import { pluginSlotsVersion, subscribePluginSlots } from './registry';
export function usePluginSlotsVersion(): number {
  return useSyncExternalStore(subscribePluginSlots, pluginSlotsVersion, pluginSlotsVersion);
}
