import { useSyncExternalStore } from 'react';
import type { PluginViewRef } from './viewBridge';

export interface PluginWorkspaceRef {
  pluginId: string;
  viewId: string;
  /** Bind the iframe to the initiating context; never retarget a pending edit to another project. */
  sessionId: string | null;
}
let active: PluginWorkspaceRef | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getPluginWorkspace = () => active;
export const usePluginWorkspace = () =>
  useSyncExternalStore(subscribe, getPluginWorkspace, getPluginWorkspace);
export const activitybarPluginViews = (views: readonly PluginViewRef[]) =>
  views.filter((view) => view.location === 'activitybar');
export const sidebarPluginViews = (views: readonly PluginViewRef[]) =>
  views.filter((view) => view.location !== 'activitybar');
export function openPluginWorkspace(view: PluginViewRef, sessionId: string | null): boolean {
  if (view.location !== 'activitybar') return false;
  if (
    active?.pluginId === view.pluginId &&
    active.viewId === view.id &&
    active.sessionId === sessionId
  )
    return true;
  active = { pluginId: view.pluginId, viewId: view.id, sessionId };
  notify();
  return true;
}
export function closePluginWorkspace(match?: PluginWorkspaceRef): void {
  if (
    !active ||
    (match &&
      (match.pluginId !== active.pluginId ||
        match.viewId !== active.viewId ||
        match.sessionId !== active.sessionId))
  )
    return;
  active = null;
  notify();
}
export function reconcilePluginWorkspace(views: readonly PluginViewRef[]): void {
  if (
    active &&
    !views.some(
      (view) =>
        view.location === 'activitybar' &&
        view.pluginId === active?.pluginId &&
        view.id === active.viewId
    )
  )
    closePluginWorkspace();
}
