import type {
  ImageProviderResult,
  ImageProviderSettings,
  ImageProviderView,
} from '@shared/imageProvider';
import { useEffect, useRef, useState } from 'react';

export function useImageProviderSettings() {
  const [view, setView] = useState<ImageProviderView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const alive = useRef(false);
  const version = useRef(0);
  const refresh = useRef<() => void>(() => {});
  const pendingRefresh = useRef(false);
  const api = typeof window === 'undefined' ? undefined : window.electronAPI?.imageProvider;
  useEffect(() => {
    alive.current = true;
    const load = async () => {
      const token = ++version.current;
      try {
        const result = await api?.read();
        if (!alive.current || token !== version.current) return;
        if (result?.ok) {
          setView(result.value);
          setError('');
        } else
          setError(result?.error ?? 'Image settings are unavailable. Restart the development app.');
      } catch {
        if (alive.current && token === version.current) setError('Could not read image settings.');
      }
    };
    refresh.current = () => {
      void load();
    };
    void load();
    const stop = api?.onChanged(() => {
      if (running.current) pendingRefresh.current = true;
      else void load();
    });
    return () => {
      alive.current = false;
      version.current++;
      stop?.();
    };
  }, [api]);
  const run = async <T>(
    operation: () => Promise<ImageProviderResult<T>>
  ): Promise<ImageProviderResult<T>> => {
    if (!api || running.current) return { ok: false, error: 'Image settings are busy.' };
    running.current = true;
    version.current++;
    setBusy(true);
    setError('');
    try {
      const result = await operation();
      if (alive.current && !result.ok) setError(result.error);
      return result;
    } catch {
      const result = { ok: false as const, error: 'Image settings request failed.' };
      if (alive.current) setError(result.error);
      return result;
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
      if (pendingRefresh.current && alive.current) {
        pendingRefresh.current = false;
        queueMicrotask(() => refresh.current());
      }
    }
  };
  const mutate = async (operation: () => Promise<ImageProviderResult<ImageProviderView>>) => {
    const result = await run(operation);
    if (result.ok && alive.current) setView(result.value);
    return result.ok;
  };
  return {
    view,
    busy,
    error,
    update: (patch: Partial<ImageProviderSettings>) => mutate(() => api!.update(patch)),
    saveConnection: (baseUrl: string, key?: string) =>
      mutate(async () => {
        if (!view?.configured || baseUrl.trim().replace(/\/+$/, '') !== view.config.baseUrl) {
          const saved = await api!.update({ baseUrl });
          if (!saved.ok) return saved;
          if (alive.current) setView(saved.value);
        }
        return key ? api!.setApiKey(baseUrl, key) : api!.read();
      }),
    clearKey: () => mutate(() => api!.setApiKey(view!.config.baseUrl, null)),
    listModels: () => run(() => api!.listModels()),
  };
}
