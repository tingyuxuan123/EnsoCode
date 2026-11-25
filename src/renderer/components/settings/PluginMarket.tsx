import { Puzzle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/i18n';
import type { NativePluginManager } from '@/plugins/useNativePluginManager';
import { usePluginMarketCatalog } from '@/plugins/usePluginMarketCatalog';
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
  const { plugins, marketId, error, stale, mirror, loading, load } = usePluginMarketCatalog();
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<MarketSection>('all');
  const [readme, setReadme] = useState<{ id: string; name: string; from: 'market' } | null>(null);
  return (
    <section className="space-y-3" data-settings-row="plugins.market" data-slot="plugin-market">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-semibold text-sm">
          {t('CodeKiln plugin market')}{' '}
          <span data-slot="market-id" className="font-normal text-muted-foreground text-xs">
            {marketId}
          </span>
        </h3>
        <label className="flex items-center gap-2 text-xs">
          {t('China mirror')}
          <Switch
            checked={mirror}
            disabled={loading}
            onCheckedChange={(value) => void load(true, value)}
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
            <p data-slot="market-compatibility" className="text-muted-foreground text-xs">
              {t('Compatible with {{version}} and later', {
                version: plugin.compatibility.minAppVersion,
              })}
              {plugin.compatibility.maxAppVersion
                ? ` · ${t('up to {{version}}', { version: plugin.compatibility.maxAppVersion })}`
                : ''}
              {' · '}
              {plugin.compatibility.testedSurfaces.length > 0
                ? `${t('Verified surfaces')}: ${plugin.compatibility.testedSurfaces.join(' / ')}`
                : t('No verified surface coverage yet')}
            </p>
            {plugin.installedSource === 'other' && (
              <p data-slot="market-source-note" className="text-warning-foreground text-xs">
                {t(
                  'Installed from another source. The plugin keeps working; cross-market migration is not supported yet.'
                )}
              </p>
            )}
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
                  plugin.installedSource === 'other' ||
                  (!!plugin.installedVersion && !plugin.updateAvailable)
                }
                onClick={() => void manager.stage('market', plugin.id)}
              >
                {t(
                  plugin.installedSource === 'other'
                    ? 'Installed from another source'
                    : plugin.updateAvailable
                      ? 'Update'
                      : plugin.installedVersion
                        ? 'Installed'
                        : 'Install'
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
