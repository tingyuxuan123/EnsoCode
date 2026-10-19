import type { BrowserDevice } from '../types/browser';
import { parseBrowserDevice } from './devices';
import { assertAllowedUrl } from './urlPolicy';

export interface PersistedBrowserTab {
  url: string;
  title: string;
  conversationId?: string;
  at?: number;
  device?: BrowserDevice;
}

export function parsePersistedBrowserTabs(raw: unknown): Record<string, PersistedBrowserTab> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, PersistedBrowserTab> = {};
  for (const [sessionId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!sessionId || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const url = (value as { url?: unknown }).url;
    const title = (value as { title?: unknown }).title;
    if (typeof url !== 'string') continue;
    try {
      assertAllowedUrl(url);
    } catch {
      continue;
    }
    const at = (value as { at?: unknown }).at;
    const conversationId = (value as { conversationId?: unknown }).conversationId;
    let device: BrowserDevice | undefined;
    try {
      const candidate = (value as { device?: unknown }).device;
      if (candidate !== undefined) device = parseBrowserDevice(candidate);
    } catch {}
    out[sessionId] = {
      ...(device ? { device } : {}),
      url,
      title: typeof title === 'string' ? title : '',
      ...(typeof conversationId === 'string' && conversationId
        ? { conversationId }
        : { conversationId: sessionId }),
      ...(typeof at === 'number' && Number.isFinite(at) ? { at } : {}),
    };
  }
  return out;
}

export function serializePersistedBrowserTabs(tabs: Record<string, PersistedBrowserTab>): string {
  return JSON.stringify(tabs);
}

export function dropPersistedTabsForSession(
  tabs: Record<string, PersistedBrowserTab>,
  sessionId: string
): Record<string, PersistedBrowserTab> {
  const next: Record<string, PersistedBrowserTab> = {};
  for (const [id, tab] of Object.entries(tabs)) {
    if (tab.conversationId === sessionId || id === sessionId) continue;
    next[id] = tab;
  }
  return next;
}
