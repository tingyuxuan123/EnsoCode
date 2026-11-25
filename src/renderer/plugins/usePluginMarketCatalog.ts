import type { ExtensionPluginMarketEntry } from '@shared/extensionPlugins/types';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Presentation-only view of Main's signed, compatibility-filtered market. */
export function usePluginMarketCatalog(enabled = true) {
  const [plugins, setPlugins] = useState<ExtensionPluginMarketEntry[]>([]);
  const [marketId, setMarketId] = useState('collabra');
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);

  const load = useCallback(
    async (refresh = false, nextMirror?: boolean) => {
      if (!enabled) return;
      const mine = ++generation.current;
      setLoading(true);
      setError('');
      try {
        const api = window.electronAPI.extensionPlugins;
        if (nextMirror !== undefined) {
          const changed = await api.marketSetChinaMirror(nextMirror);
          if (mine !== generation.current) return;
          if (!changed.ok) {
            setError(changed.error ?? 'Operation failed');
            return;
          }
        }
        const result = await api.marketList(refresh);
        if (mine !== generation.current) return;
        setMirror(result.chinaMirror);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setPlugins(result.plugins);
        setMarketId(result.marketId);
        setStale(result.stale);
      } catch (reason) {
        if (mine === generation.current) setError(String(reason));
      } finally {
        if (mine === generation.current) setLoading(false);
      }
    },
    [enabled]
  );

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = window.electronAPI.extensionPlugins.onChanged(() => void load());
    void load();
    return () => {
      generation.current++;
      unsubscribe();
    };
  }, [enabled, load]);

  return { plugins, marketId, error, stale, mirror, loading, load };
}
