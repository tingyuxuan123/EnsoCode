import type { DeviceAccessEntry } from '@shared/device-agent';
import { useEffect } from 'react';
import { create } from 'zustand';

const empty: DeviceAccessEntry[] = [];
const useEntries = create<{ bySession: Record<string, DeviceAccessEntry[]> }>(() => ({
  bySession: {},
}));
const watches = new Map<string, { refs: number; close(): void }>();

function replace(sessionId: string, entries: DeviceAccessEntry[]) {
  useEntries.setState(({ bySession }) => ({ bySession: { ...bySession, [sessionId]: entries } }));
}

function watch(sessionId: string): () => void {
  const api = window.electronAPI?.devices;
  if (!sessionId || !api?.listAccess || !api.onAccessChanged) return () => {};
  let active = watches.get(sessionId);
  if (!active) {
    // Subscribe first: decisions and revocations received during the initial read win over it.
    let live = true;
    const stop = api.onAccessChanged((entry) => {
      if (!live || entry.sessionId !== sessionId) return;
      const merged = new Map(
        (useEntries.getState().bySession[sessionId] ?? []).map((e) => [e.id, e])
      );
      merged.set(entry.id, entry);
      replace(sessionId, [...merged.values()]);
    });
    void api
      .listAccess(sessionId)
      .then((snapshot) => {
        if (!live) return;
        const merged = new Map(snapshot.map((entry) => [entry.id, entry]));
        for (const entry of useEntries.getState().bySession[sessionId] ?? [])
          merged.set(entry.id, entry);
        replace(sessionId, [...merged.values()]);
      })
      .catch(() => {}); // A closing or non-workbench window cannot read the ledger.
    active = {
      refs: 0,
      close() {
        live = false;
        stop();
      },
    };
    watches.set(sessionId, active);
  }
  active.refs++;
  return () => {
    if (--active.refs) return;
    active.close();
    watches.delete(sessionId);
    useEntries.setState(({ bySession }) => {
      const next = { ...bySession };
      delete next[sessionId];
      return { bySession: next };
    });
  };
}

export function useDeviceAccessEntries(sessionId: string): DeviceAccessEntry[] {
  useEffect(() => watch(sessionId), [sessionId]);
  return useEntries((state) => state.bySession[sessionId] ?? empty);
}

export function usePendingDeviceAccess(sessionId: string | null | undefined): boolean {
  return useDeviceAccessEntries(sessionId ?? '').some((entry) => entry.decision === null);
}

export function hasPendingDeviceAccess(sessionId: string | null | undefined): boolean {
  return (
    useEntries.getState().bySession[sessionId ?? '']?.some((entry) => entry.decision === null) ??
    false
  );
}
