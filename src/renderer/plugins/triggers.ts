import { useEffect, useState, useSyncExternalStore } from 'react';
import { hasActivePluginGesture } from './userGesture';
export interface PluginTriggerItem {
  id: string;
  label: string;
  detail?: string;
}
export interface PluginCandidate {
  key: string;
  pluginId: string;
  name: string;
  item: PluginTriggerItem;
}
interface PluginTriggerRef {
  pluginId: string;
  name: string;
}
export function extractTriggerQuery(before: string): string | null {
  return /(?:^|\s)#([^\s#]*)$/.exec(before)?.[1] ?? null;
}
export function normalizeCandidates(
  pluginId: string,
  name: string,
  raw: unknown
): PluginCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: PluginCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (out.length >= 50) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, label, detail } = entry as Record<string, unknown>;
    if (
      typeof id !== 'string' ||
      !id ||
      id.length > 200 ||
      typeof label !== 'string' ||
      !label ||
      seen.has(id)
    )
      continue;
    seen.add(id);
    out.push({
      key: `${pluginId}:${name}:${id}`,
      pluginId,
      name,
      item: {
        id,
        label: label.slice(0, 64),
        ...(typeof detail === 'string' && detail ? { detail: detail.slice(0, 120) } : {}),
      },
    });
  }
  return out;
}
export function normalizePick(raw: unknown): string | null {
  const text =
    typeof raw === 'string'
      ? raw
      : typeof raw === 'object' && raw !== null && 'text' in raw
        ? raw.text
        : null;
  return typeof text === 'string' && new TextEncoder().encode(text).length <= 32768 ? text : null;
}
let triggers: PluginTriggerRef[] = [];
const listeners = new Set<() => void>();
export function setPluginTriggers(next: PluginTriggerRef[]): void {
  triggers = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => triggers;
const EMPTY: PluginCandidate[] = [];
export function usePluginTriggerCandidates(
  query: string | null,
  sessionId: string | null
): PluginCandidate[] {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [result, setResult] = useState<{
    query: string | null;
    list: PluginTriggerRef[];
    sessionId: string | null;
    items: PluginCandidate[];
  } | null>(null);
  useEffect(() => {
    if (query === null || list.length === 0 || !sessionId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void Promise.all(
        list.map(async ({ pluginId, name }) => {
          try {
            const response = await window.electronAPI.extensionPlugins.call({
              pluginId,
              method: 'trigger.candidates',
              payload: { name, query },
              sessionId,
              gesture: false,
            });
            return response.ok ? normalizeCandidates(pluginId, name, response.value) : EMPTY;
          } catch {
            return EMPTY;
          }
        })
      ).then((groups) => {
        if (!cancelled) setResult({ query, list, sessionId, items: groups.flat().slice(0, 50) });
      });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, sessionId, list]);
  return result?.query === query && result.list === list && result.sessionId === sessionId
    ? result.items
    : EMPTY;
}
export async function pickPluginCandidate(
  candidate: PluginCandidate,
  sessionId: string | null
): Promise<string | null> {
  if (
    !triggers.some(
      (entry) => entry.pluginId === candidate.pluginId && entry.name === candidate.name
    )
  )
    return null;
  try {
    const response = await window.electronAPI.extensionPlugins.call({
      pluginId: candidate.pluginId,
      method: 'trigger.pick',
      payload: { name: candidate.name, item: candidate.item },
      sessionId,
      gesture: hasActivePluginGesture(),
    });
    return response.ok ? normalizePick(response.value) : null;
  } catch {
    return null;
  }
}
