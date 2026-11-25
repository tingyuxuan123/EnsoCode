import type { MarketScreenshot } from '@shared/extensionPlugins/marketCategories';
import type {
  ExtensionPluginMarketEntry,
  ExtensionPluginSummary,
} from '@shared/extensionPlugins/types';
import { Aperture, ArrowDownToLine, ImageOff, Puzzle, Settings2, Shield } from 'lucide-react';
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { PluginIcon } from '@/plugins/PluginIcon';
import type { NativePluginManager } from '@/plugins/useNativePluginManager';
import { marketSectionLabel } from '../settings/pluginMarketFilter';
import { ExtensionShowcaseReadme } from './ExtensionShowcaseReadme';
import { ExtensionStoryBlocks } from './ExtensionStoryBlocks';
import { knowledgeMapOverview } from './knowledgeMapOverview';
import { PluginPermissionAccess } from './PluginPermissionAccess';

export interface ExtensionShowcaseProps {
  entry:
    | { kind: 'market'; plugin: ExtensionPluginMarketEntry }
    | { kind: 'installed'; plugin: ExtensionPluginSummary };
  manager: NativePluginManager;
  documentationReady?: boolean;
  onManageInstalled?(id: string): void;
}

const installedStatus = {
  enabled: 'Enabled',
  disabled: 'Disabled',
  crashed: 'Plugin crashed',
} as const;

function installedSourceLabel(source: ExtensionPluginSummary['source']): string {
  switch (source?.kind) {
    case 'market':
      return source.marketId ? 'CodeKiln market' : 'Installed from the previous plugin market';
    case 'dir':
      return 'Local folder';
    case 'zip':
      return 'ZIP package';
    case 'url':
      return 'HTTPS link';
    default:
      return 'Unknown source';
  }
}

function MarketIcon({ src, isTheme }: { src?: string; isTheme: boolean }) {
  const [failed, setFailed] = useState(false);
  const Fallback = isTheme ? Aperture : Puzzle;
  return src && !failed ? (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      className="size-11 rounded-md object-contain"
      onError={() => setFailed(true)}
    />
  ) : (
    <Fallback className="size-8" />
  );
}

function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'max-w-full rounded-full border border-border px-2.5 py-1 text-xs [overflow-wrap:anywhere]',
        className
      )}
    >
      {children}
    </span>
  );
}

function Screenshot({ shot }: { shot: MarketScreenshot }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  return (
    <figure className="min-w-0 overflow-hidden rounded-xl border border-border">
      {failed ? (
        <p className="flex min-h-28 items-center justify-center gap-2 bg-secondary text-muted-foreground text-sm">
          <ImageOff aria-hidden className="size-4" />
          {t('Screenshot unavailable')}
        </p>
      ) : (
        <img
          className="block max-h-[32rem] w-full object-contain"
          src={shot.url}
          alt={shot.alt}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
      {shot.alt && (
        <figcaption className="border-border border-t px-4 py-2.5 text-muted-foreground text-xs [overflow-wrap:anywhere]">
          {shot.alt}
        </figcaption>
      )}
    </figure>
  );
}

function MarketFacts({ plugin }: { plugin: ExtensionPluginMarketEntry }) {
  const { t } = useI18n();
  const { minAppVersion, maxAppVersion, testedSurfaces } = plugin.compatibility;
  return (
    <section className="space-y-4 border-border border-t pt-6">
      <h2 className="font-semibold text-xl">{t('Compatibility')}</h2>
      <dl className="grid gap-x-8 gap-y-5 text-sm @min-[30rem]:grid-cols-2">
        {minAppVersion && (
          <div>
            <dt className="font-medium">{t('CodeKiln version')}</dt>
            <dd className="mt-1 text-muted-foreground">
              {t('Compatible with {{version}} and later', { version: minAppVersion })}
              {maxAppVersion && ` · ${t('up to {{version}}', { version: maxAppVersion })}`}
            </dd>
          </div>
        )}
        <div>
          <dt className="font-medium">{t('Verified surfaces')}</dt>
          <dd className="mt-1 text-muted-foreground [overflow-wrap:anywhere]">
            {testedSurfaces.length
              ? testedSurfaces.join(' / ')
              : t('No verified surface coverage yet')}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function InstalledFeatures({ plugin }: { plugin: ExtensionPluginSummary }) {
  const { t } = useI18n();
  const contributions = [
    { label: 'Views', names: plugin.views?.map((view) => view.title) },
    { label: 'Commands', names: plugin.commands?.map((command) => command.title) },
    { label: 'Tools', names: plugin.tools?.map((tool) => tool.name) },
    { label: 'Themes', names: plugin.themes?.map((theme) => theme.name) },
  ].filter((item) => item.names?.length);
  if (!contributions.length) return null;
  return (
    <section className="space-y-4 border-border border-t pt-6">
      <h2 className="font-semibold text-xl">{t('Included features')}</h2>
      <dl className="grid gap-x-8 gap-y-5 text-sm @min-[30rem]:grid-cols-2">
        {contributions.map(({ label, names }) => (
          <div key={label}>
            <dt className="font-medium">{t(label)}</dt>
            <dd className="mt-1 text-muted-foreground [overflow-wrap:anywhere]">
              {names?.join(' · ')}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * A plugin's last error is diagnostic, not a product description: keep it out of the reading
 * flow and make it something the user can act on or copy when reporting the problem.
 */
function LastErrorNotice({ error }: { error: NonNullable<ExtensionPluginSummary['lastError']> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const firstLine = error.message.split('\n')[0]?.slice(0, 240) ?? error.message;
  const copy = () =>
    void navigator.clipboard.writeText(error.message).then(
      () => addToast({ type: 'success', title: t('Copied') }),
      () => addToast({ type: 'error', title: t('Copy failed') })
    );
  return (
    <section className="rounded-xl border border-warning/30 bg-warning/5 px-3.5 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <span className="font-medium">{t('The plugin reported an error')}</span>
          <span className="mt-0.5 block text-muted-foreground text-xs">
            {new Date(error.at).toLocaleString()} · {firstLine}
          </span>
        </p>
        <Button size="xs" variant="ghost" onClick={() => setOpen((value) => !value)}>
          {t(open ? 'Hide details' : 'Show details')}
        </Button>
      </div>
      {open && (
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/60 p-2.5 font-mono text-xs leading-relaxed">
          {error.message}
        </pre>
      )}
      <Button size="xs" variant="ghost" className="mt-1.5 -ml-1.5" onClick={copy}>
        {t('Copy error')}
      </Button>
    </section>
  );
}

function ShowcaseSheet({
  entry,
  manager,
  documentationReady,
  onManageInstalled,
}: ExtensionShowcaseProps) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [permissionVersion, setPermissionVersion] = useState<'current' | 'pending'>('current');
  const overview = useRef<HTMLElement>(null);
  const permissionPage = useRef<HTMLDivElement>(null);
  const permissionTrigger = useRef<HTMLButtonElement>(null);
  const returnScroll = useRef<number | null>(null);
  const market = entry.kind === 'market' ? entry.plugin : null;
  const installed = entry.kind === 'installed' ? entry.plugin : null;
  const { plugin } = entry;
  const version = entry.kind === 'market' ? entry.plugin.latest : entry.plugin.version;
  const knowledgeMap = plugin.id === 'codekiln.llmdoc';
  const localMatch = market && manager.plugins.find((candidate) => candidate.id === market.id);
  // The signed catalog can briefly lag the installed registry after a local install.
  const sourceConflict =
    market?.installedSource === 'other' ||
    (!!localMatch && (localMatch.source?.kind !== 'market' || !localMatch.source.marketId));
  const marketInstalledVersion = localMatch?.version || market?.installedVersion;
  const marketStatus = sourceConflict
    ? t('Installed from another source')
    : marketInstalledVersion
      ? t('Installed version: {{version}}', { version: marketInstalledVersion })
      : t('Not installed');
  const marketAction = sourceConflict
    ? 'Installed from another source'
    : market?.updateAvailable
      ? 'Review update'
      : marketInstalledVersion
        ? 'Installed'
        : 'Install';
  const category = market?.category ? marketSectionLabel(market.category, locale) : null;
  const tags = [...new Set(market?.tags ?? [])].filter((tag) => tag !== category);
  // Market metadata describes the candidate package. Only the actual matching local record
  // can supply current configuration, and a pending candidate never inherits those controls.
  const currentInstalled = installed ?? (localMatch && !sourceConflict ? localMatch : null);
  const pending =
    installed?.pendingVersion && installed.pendingPermissions
      ? { version: installed.pendingVersion, permissions: installed.pendingPermissions }
      : null;
  const usePending = !!pending && permissionVersion === 'pending';
  const marketUpdate = !!market?.updateAvailable && !sourceConflict;
  const permissionMode =
    usePending || marketUpdate ? 'update' : currentInstalled ? 'installed' : 'available';
  const permissions = usePending
    ? pending.permissions
    : permissionMode === 'installed' && currentInstalled
      ? currentInstalled.permissions
      : plugin.permissions;
  const crossSession =
    permissionMode === 'installed' && currentInstalled?.crossSessionInject !== undefined
      ? {
          enabled: currentInstalled.crossSessionInject,
          disabled: !manager.canManage || !!manager.busy,
          onChange(enabled: boolean) {
            if (
              !enabled ||
              window.confirm(
                t('Allow this plugin to send messages to other sessions and trigger execution?')
              )
            )
              void manager.setCrossSessionInject(currentInstalled.id, enabled);
          },
        }
      : undefined;

  useLayoutEffect(() => {
    const scroller = overview.current?.closest<HTMLElement>(
      '[data-slot="extension-showcase-scroll"]'
    );
    if (permissionsOpen) {
      if (scroller) scroller.scrollTop = 0;
      permissionPage.current
        ?.querySelector<HTMLElement>('[data-slot="permission-access-back"]')
        ?.focus({ preventScroll: true });
    } else if (returnScroll.current !== null) {
      if (scroller) scroller.scrollTop = returnScroll.current;
      returnScroll.current = null;
      permissionTrigger.current?.focus({ preventScroll: true });
    }
  }, [permissionsOpen]);

  return (
    <>
      <article
        ref={overview}
        hidden={permissionsOpen}
        data-extension-overview=""
        aria-labelledby={titleId}
        className="@container w-full min-w-0"
        data-slot="extension-showcase"
      >
        <div className="mx-auto max-w-[1140px] space-y-8 px-5 pt-7 pb-12 @min-[36rem]:px-7">
          <header className="flex flex-col gap-5">
            <div className="flex min-w-0 items-start gap-4 pr-7 @min-[36rem]:gap-5">
              <div
                aria-hidden
                className="flex size-16 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary text-foreground @min-[36rem]:size-20"
              >
                {market ? (
                  <MarketIcon
                    key={market.icon}
                    src={market.icon}
                    isTheme={market.category === 'themes'}
                  />
                ) : (
                  <PluginIcon
                    pluginId={plugin.id}
                    icon={plugin.icon}
                    className="size-11 object-contain"
                  />
                )}
              </div>
              <div className="min-w-0 space-y-2">
                <p className="font-medium text-muted-foreground text-sm">{t('CodeKiln plugin')}</p>
                <h1
                  id={titleId}
                  className="font-semibold text-2xl leading-tight tracking-tight [overflow-wrap:anywhere] @min-[36rem]:text-3xl"
                >
                  {plugin.name}
                </h1>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-sm [overflow-wrap:anywhere]">
                  <span>
                    {t('Version')} {version}
                  </span>
                  <span>
                    {t(market ? 'CodeKiln market' : installedSourceLabel(installed?.source))}
                  </span>
                  {installed && (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5',
                        installed.state === 'enabled' && 'text-success',
                        installed.state === 'crashed' && 'text-destructive'
                      )}
                    >
                      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
                      {t(installedStatus[installed.state])}
                    </span>
                  )}
                  {market && <span>{marketStatus}</span>}
                </div>
              </div>
            </div>

            {(knowledgeMap || plugin.description) && (
              <p className="max-w-[68ch] text-base text-foreground/85 leading-relaxed [overflow-wrap:anywhere]">
                {knowledgeMap
                  ? t(
                      'Find project knowledge, connect it to source files, and review what changed in your local Git worktree.'
                    )
                  : plugin.description}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
              {market && <Pill>{t(market.tier === 'official' ? 'Official' : 'Community')}</Pill>}
              {category && <Pill>{category}</Pill>}
              {tags.map((tag) => (
                <Pill key={tag}>{tag}</Pill>
              ))}
              {knowledgeMap && <Pill>{t('Local Git worktree')}</Pill>}
              {installed?.pendingVersion && (
                <Pill className="border-warning/30 text-foreground">
                  {t('Pending permission approval')}
                </Pill>
              )}
            </div>

            <div className="flex flex-wrap items-stretch gap-2.5">
              {market && (
                <Button
                  size="xl"
                  disabled={
                    !manager.canManage ||
                    !!manager.busy ||
                    sourceConflict ||
                    (!!marketInstalledVersion && !market.updateAvailable)
                  }
                  onClick={() => void manager.stage('market', market.id)}
                  className="h-auto min-h-10 max-w-full flex-[1_1_200px] whitespace-normal py-2"
                >
                  <ArrowDownToLine aria-hidden />
                  {t(marketAction)}
                </Button>
              )}
              {installed && onManageInstalled && (
                <Button
                  size="xl"
                  disabled={!!manager.busy}
                  onClick={() => onManageInstalled(installed.id)}
                  className="h-auto min-h-10 max-w-full flex-[1_1_200px] whitespace-normal py-2"
                >
                  <Settings2 aria-hidden />
                  {t(installed.pendingVersion ? 'Review update permissions' : 'Manage plugin')}
                </Button>
              )}
              <Button
                ref={permissionTrigger}
                size="xl"
                variant="secondary"
                onClick={() => {
                  returnScroll.current =
                    overview.current?.closest<HTMLElement>(
                      '[data-slot="extension-showcase-scroll"]'
                    )?.scrollTop ?? 0;
                  setPermissionVersion('current');
                  setPermissionsOpen(true);
                }}
                className="h-auto min-h-10"
              >
                <Shield aria-hidden />
                {t('Permissions & data access')}
              </Button>
            </div>

            {sourceConflict && (
              <p className="max-w-[68ch] rounded-lg border border-warning/30 px-3.5 py-2.5 text-sm">
                {t(
                  'Installed from another source. The plugin keeps working; cross-market migration is not supported yet.'
                )}
              </p>
            )}
            {installed?.lastError && <LastErrorNotice error={installed.lastError} />}
          </header>

          {market?.screenshots?.length ? (
            <section className="space-y-3">
              <h2 className="font-semibold text-xl">{t('Screenshots')}</h2>
              <div
                className={cn(
                  'grid gap-3',
                  market.screenshots.length > 1 && '@min-[36rem]:grid-cols-2'
                )}
              >
                {market.screenshots.map((shot) => (
                  <Screenshot key={shot.url} shot={shot} />
                ))}
              </div>
            </section>
          ) : null}

          {knowledgeMap ? (
            <ExtensionStoryBlocks blocks={knowledgeMapOverview} />
          ) : installed ? (
            <InstalledFeatures plugin={installed} />
          ) : null}
          {market && <MarketFacts plugin={market} />}
          <ExtensionShowcaseReadme id={plugin.id} from={entry.kind} ready={documentationReady} />
          <p className="border-line border-t pt-3 font-mono text-muted-foreground text-xs [overflow-wrap:anywhere]">
            {plugin.id}
          </p>
        </div>
      </article>
      {permissionsOpen && (
        <div
          ref={permissionPage}
          data-slot="extension-permissions-page"
          className="mx-auto max-w-[1140px] px-5 pt-7 pb-12 sm:px-7"
        >
          <PluginPermissionAccess
            pluginName={plugin.name}
            permissions={permissions}
            mode={permissionMode}
            pendingVersion={
              usePending ? pending.version : marketUpdate ? market?.latest : undefined
            }
            crossSession={crossSession}
            onBack={() => setPermissionsOpen(false)}
            versionSwitcher={
              pending && (
                <div role="group" aria-label={t('Version')} className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['current', t('Current installation')],
                      ['pending', t('Pending version {{version}}', { version: pending.version })],
                    ] as const
                  ).map(([value, label]) => (
                    <Button
                      key={value}
                      size="sm"
                      aria-pressed={permissionVersion === value}
                      variant={permissionVersion === value ? 'secondary' : 'ghost'}
                      onClick={() => setPermissionVersion(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              )
            }
          />
        </div>
      )}
    </>
  );
}

/** Inline product sheet; install review and installed management remain owned by the parent. */
export function ExtensionShowcase(props: ExtensionShowcaseProps) {
  const { entry } = props;
  const identity = entry.kind === 'installed' ? entry.plugin.build : entry.plugin.latest;
  return <ShowcaseSheet key={JSON.stringify([entry.kind, entry.plugin.id, identity])} {...props} />;
}
