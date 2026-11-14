import type { ExtensionPluginMarketEntry } from '@shared/extensionPlugins/types';
import { Puzzle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/i18n';
import type { NativePluginManager } from '@/plugins/useNativePluginManager';
import { PluginReadmeDialog } from './PluginReadmeDialog';
import {
  filterMarketPlugins,
  type MarketSection,
  marketSectionLabel,
  marketSections,
} from './pluginMarketFilter';

/** 远程图标可能过期或被拦截：失败或缺省时用中性占位，不给浏览器破图。 */
function MarketIcon({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed)
    return (
      <span
        aria-hidden
        data-slot="market-icon-fallback"
        className="flex size-9 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground"
      >
        <Puzzle className="size-5" />
      </span>
    );
  return (
    <img
      data-slot="market-icon"
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      className="size-9 shrink-0 rounded object-contain"
      onError={() => setFailed(true)}
    />
  );
}

/** Market is a read-only catalog until an explicit stage → review → commit gesture. */
export function PluginMarket({ manager }: { manager: NativePluginManager }) {
  const { t, locale } = useI18n();
  const [plugins, setPlugins] = useState<ExtensionPluginMarketEntry[]>([]);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<MarketSection>('all');
  const [readme, setReadme] = useState<{ id: string; name: string; from: 'market' } | null>(null);
  const generation = useRef(0);
  const load = useCallback(async (refresh = false) => {
    const mine = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const result = await window.electronAPI.extensionPlugins.marketList(refresh);
      if (mine !== generation.current) return;
      setMirror(result.chinaMirror);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPlugins(result.plugins);
      setStale(result.stale);
    } catch (reason) {
      if (mine === generation.current) setError(String(reason));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const unsubscribe = window.electronAPI.extensionPlugins.onChanged(() => void load());
    return () => {
      generation.current++;
      unsubscribe();
    };
  }, [load]);
  return (
    <section className="space-y-3" data-settings-row="plugins.market" data-slot="plugin-market">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-semibold text-sm">{t('Plugin market')}</h3>
        <label className="flex items-center gap-2 text-xs">
          {t('China mirror')}
          <Switch
            checked={mirror}
            disabled={loading}
            onCheckedChange={(value) => {
              setLoading(true);
              void window.electronAPI.extensionPlugins
                .marketSetChinaMirror(value)
                .then((result) => {
                  if (!result.ok) {
                    setError(result.error ?? 'Operation failed');
                    setLoading(false);
                  } else void load(true);
                });
            }}
          />
        </label>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(true)}>
          {t('Refresh')}
        </Button>
      </div>
      <Input
        aria-label={t('Search plugins')}
        placeholder={t('Search plugins')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {marketSections(plugins).map((item) => (
          <Button
            key={item.id}
            data-slot="market-section"
            size="sm"
            variant={section === item.id ? 'secondary' : 'ghost'}
            onClick={() => setSection(item.id)}
          >
            {marketSectionLabel(item.id, locale)} ({item.count})
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      {stale && (
        <p role="status" className="text-warning-foreground text-xs">
          {t('Showing cached plugin catalog')}
        </p>
      )}
      {loading && (
        <p role="status" className="text-xs">
          {t('Loading plugins…')}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {filterMarketPlugins(plugins, { query, section }).map((plugin) => (
          <article key={plugin.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex gap-2">
              {/* 图标地址变了就重挂，失败的占位不会跟着旧地址残留 */}
              <MarketIcon key={plugin.icon ?? 'no-icon'} src={plugin.icon} />
              <div className="min-w-0">
                <h4 className="truncate font-medium text-sm">
                  {plugin.name}{' '}
                  <span className="text-muted-foreground text-xs">{plugin.latest}</span>
                </h4>
                <p className="text-muted-foreground text-xs">
                  {plugin.tier} · {plugin.id}
                </p>
              </div>
            </div>
            <p className="text-xs">{plugin.description}</p>
            <p className="break-words font-mono text-muted-foreground text-xs">
              {plugin.permissions.join(' · ')}
            </p>
            {plugin.screenshots?.length ? (
              <div className="flex gap-2 overflow-x-auto">
                {plugin.screenshots.map((shot) => (
                  <img
                    key={shot.url}
                    src={shot.url}
                    alt={shot.alt}
                    referrerPolicy="no-referrer"
                    className="h-28 rounded object-contain"
                  />
                ))}
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setReadme({ id: plugin.id, name: plugin.name, from: 'market' })}
              >
                {t('Documentation')}
              </Button>
              <Button
                size="sm"
                disabled={
                  !manager.canManage ||
                  !!manager.busy ||
                  (!!plugin.installedVersion && !plugin.updateAvailable)
                }
                onClick={() => void manager.stage('market', plugin.id)}
              >
                {t(
                  plugin.updateAvailable
                    ? 'Update'
                    : plugin.installedVersion
                      ? 'Installed'
                      : 'Review installation'
                )}
              </Button>
            </div>
          </article>
        ))}
      </div>
      {!loading && !error && plugins.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
          {t('No plugins found')}
        </p>
      )}
      <PluginReadmeDialog plugin={readme} onClose={() => setReadme(null)} />
    </section>
  );
}
