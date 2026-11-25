import type { ExtensionPluginMarketEntry } from '@shared/extensionPlugins/types';
import {
  Aperture,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Compass,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import {
  filterMarketPlugins,
  type MarketSection,
  marketSectionLabel,
  marketSections,
} from '@/components/settings/pluginMarketFilter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Menu,
  MenuCheckboxItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import type { NativePluginManager } from '@/plugins/useNativePluginManager';
import type { usePluginMarketCatalog } from '@/plugins/usePluginMarketCatalog';

type Market = ReturnType<typeof usePluginMarketCatalog>;

export function ExtensionMarketActions({ market }: { market: Market }) {
  const { t } = useI18n();
  return (
    <>
      <Menu modal={false}>
        <MenuTrigger render={<Button variant="ghost" size="sm" aria-label={t('Market sources')} />}>
          <Compass />
          {t('Market sources')}
        </MenuTrigger>
        <MenuPopup align="end" className="w-56">
          <div className="px-2 py-1.5">
            <p className="font-semibold text-xs">{t('CodeKiln plugin market')}</p>
            <p className="mt-1 text-muted-foreground text-xs">{market.marketId}</p>
          </div>
          <MenuSeparator />
          <MenuCheckboxItem
            checked={market.mirror}
            disabled={market.loading}
            onCheckedChange={(value) => void market.load(true, value)}
          >
            {t('China mirror')}
          </MenuCheckboxItem>
        </MenuPopup>
      </Menu>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('Refresh plugin market')}
        title={t('Refresh plugin market')}
        disabled={market.loading}
        onClick={() => void market.load(true)}
      >
        <RefreshCw className={cn(market.loading && 'motion-safe:animate-spin')} />
      </Button>
    </>
  );
}

function MarketIcon({
  plugin,
  className,
}: {
  plugin: ExtensionPluginMarketEntry;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const Fallback = plugin.category === 'themes' ? Aperture : Puzzle;
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-10 shrink-0 place-items-center overflow-hidden rounded-[11px] bg-muted text-foreground/70',
        className
      )}
    >
      {plugin.icon && !broken ? (
        <img
          src={plugin.icon}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full object-contain"
          onError={() => setBroken(true)}
        />
      ) : (
        <Fallback className="size-[48%]" strokeWidth={1.55} />
      )}
    </span>
  );
}

function ExtensionSpotlight({
  plugin,
  onOpen,
}: {
  plugin: ExtensionPluginMarketEntry;
  onOpen(): void;
}) {
  const { t } = useI18n();
  return (
    <section
      data-slot="extension-feature"
      className="grid overflow-hidden rounded-[18px] border border-line bg-card/75 @min-[610px]:grid-cols-[1.14fr_1fr]"
    >
      {/* Catalog artwork uses the real extension's icon. Unlike screenshots, it illustrates rather than previews. */}
      <div
        aria-hidden
        className="relative isolate grid min-h-[144px] place-items-center overflow-hidden bg-linear-to-br from-brand/25 via-brand/10 to-info/15 @min-[610px]:min-h-[192px]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_70%_18%,var(--color-card),transparent_62%)] opacity-75" />
        <div className="pointer-events-none absolute top-1/2 left-1/2 size-[230px] -translate-1/2 rounded-full border border-foreground/10" />
        <div className="pointer-events-none absolute top-1/2 left-1/2 size-[168px] -translate-1/2 rounded-full border border-foreground/10" />
        <div className="absolute top-[24%] left-[57%] h-[52%] w-[27%] rotate-12 rounded-xl border border-foreground/10 bg-card/75 p-2 shadow-sm">
          <div className="h-1 w-2/3 rounded-full bg-foreground/20" />
          <div className="mt-2 h-5 w-full rounded-md bg-brand/20" />
          <div className="mt-1.5 h-1 w-3/4 rounded-full bg-foreground/10" />
        </div>
        <div className="absolute top-[24%] right-[58%] h-[55%] w-[25%] -rotate-12 rounded-xl border border-foreground/10 bg-foreground/8 p-2.5 shadow-sm">
          <div className="h-1 w-3/5 rounded-full bg-foreground/22" />
          <div className="mt-2 h-6 w-full rounded-md bg-card/75" />
          <div className="mt-1.5 h-1 w-2/3 rounded-full bg-foreground/12" />
        </div>
        <MarketIcon
          key={plugin.icon}
          plugin={plugin}
          className="relative size-[86px] -rotate-6 rounded-[22px] border-4 border-card bg-panel text-foreground shadow-float"
        />
      </div>
      <div className="flex min-w-0 flex-col justify-center px-6 py-5 @min-[850px]:px-8">
        <p className="font-medium text-muted-foreground text-xs">{t('Featured extension')}</p>
        <h2 className="mt-1.5 wrap-anywhere font-semibold text-xl leading-tight tracking-tight">
          {plugin.name}
        </h2>
        <p className="mt-2 line-clamp-3 text-muted-foreground text-sm leading-relaxed">
          {plugin.description}
        </p>
        <Button size="sm" className="mt-3.5 w-fit" onClick={onOpen}>
          {t('View extension details')}
          <ArrowUpRight className="size-3" />
        </Button>
      </div>
    </section>
  );
}

function PublicExtensionRow({
  plugin,
  manager,
  onOpen,
}: {
  plugin: ExtensionPluginMarketEntry;
  manager: NativePluginManager;
  onOpen(): void;
}) {
  const { t } = useI18n();
  const unavailable = plugin.installedSource === 'other';
  const installed = !!plugin.installedVersion && !plugin.updateAvailable;
  const action = t(plugin.updateAvailable ? 'Update' : 'Install');
  const status = t(unavailable ? 'Installed from another source' : 'Installed');
  return (
    <article
      data-market-plugin={plugin.id}
      className="flex min-w-0 items-center rounded-xl pr-1 transition-colors hover:bg-accent/75 focus-within:bg-accent/75 motion-reduce:transition-none"
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-2.5 pr-2 pl-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onOpen}
      >
        <MarketIcon key={plugin.icon} plugin={plugin} />
        <span className="min-w-0">
          <span className="block truncate font-semibold text-sm" title={plugin.name}>
            {plugin.name}
          </span>
          <span
            className="mt-0.5 block truncate text-muted-foreground text-xs"
            title={plugin.description}
          >
            {plugin.description}
          </span>
        </span>
      </button>
      {unavailable || installed ? (
        <span
          className="grid size-8 shrink-0 place-items-center text-muted-foreground"
          title={status}
          aria-label={status}
          role="img"
        >
          <Check className="size-4" strokeWidth={1.65} />
        </span>
      ) : (
        <Button
          data-slot="market-row-action"
          variant="ghost"
          size="icon-sm"
          aria-label={`${action}: ${plugin.name}`}
          title={action}
          disabled={!manager.canManage || !!manager.busy}
          onClick={() => void manager.stage('market', plugin.id)}
        >
          {plugin.updateAvailable ? <ArrowDownToLine /> : <Plus strokeWidth={1.65} />}
        </Button>
      )}
    </article>
  );
}

export function PublicExtensionCatalog({
  market,
  manager,
  addAction,
  onOpen,
}: {
  market: Market;
  manager: NativePluginManager;
  addAction: ReactNode;
  onOpen(id: string): void;
}) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<MarketSection>('all');
  const sections = marketSections(market.plugins);
  const selectedSection = sections.some((item) => item.id === section) ? section : 'all';
  const filtered = !!query.trim() || selectedSection !== 'all';
  const visible = filterMarketPlugins(market.plugins, { query, section: selectedSection });
  const featured = !filtered
    ? (visible.find((entry) => entry.id === 'codekiln.llmdoc' && entry.tier === 'official') ??
      visible.find((entry) => entry.tier === 'official'))
    : undefined;

  return (
    <section data-slot="extensions-discovery" className="space-y-4">
      {featured && <ExtensionSpotlight plugin={featured} onOpen={() => onOpen(featured.id)} />}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="relative min-w-36 max-w-66 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={t('Search plugins')}
            placeholder={t('Search plugins')}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="bg-muted/60 [&_input]:pl-8"
          />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Menu modal={false}>
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('Filter plugins')}
                  title={t('Filter plugins')}
                  className={cn(
                    selectedSection !== 'all' &&
                      'bg-selection text-selection-foreground hover:bg-selection'
                  )}
                />
              }
            >
              <SlidersHorizontal />
            </MenuTrigger>
            <MenuPopup align="end" className="w-48">
              {sections.map((item) => (
                <MenuCheckboxItem
                  key={item.id}
                  checked={item.id === selectedSection}
                  onCheckedChange={(checked) => setSection(checked ? item.id : 'all')}
                >
                  {marketSectionLabel(item.id, locale)} ({item.count})
                </MenuCheckboxItem>
              ))}
            </MenuPopup>
          </Menu>
          {addAction}
        </div>
      </div>
      {market.error && (
        <div
          role="alert"
          className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-muted p-3 text-sm"
        >
          <p className="break-words text-destructive">{market.error}</p>
          <Button variant="outline" size="xs" onClick={() => void market.load(true)}>
            {t('Retry')}
          </Button>
        </div>
      )}
      {market.stale && (
        <p role="status" className="text-warning-foreground text-xs">
          {t('Showing cached plugin catalog')}
        </p>
      )}
      {market.loading && !visible.length && (
        <p role="status" className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner />
          {t('Loading plugins…')}
        </p>
      )}
      {visible.length > 0 ? (
        <div className="grid min-w-0 gap-x-5 gap-y-0.5 @min-[570px]:grid-cols-2">
          {visible.map((entry) => (
            <PublicExtensionRow
              key={entry.id}
              plugin={entry}
              manager={manager}
              onOpen={() => onOpen(entry.id)}
            />
          ))}
        </div>
      ) : (
        !market.loading &&
        !market.error && (
          <div className="rounded-xl border border-line border-dashed py-8 text-center text-muted-foreground text-sm">
            <p>{t('No plugins found')}</p>
            {filtered && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                onClick={() => {
                  setSection('all');
                  setQuery('');
                }}
              >
                {t('Clear filters')}
              </Button>
            )}
          </div>
        )
      )}
    </section>
  );
}
