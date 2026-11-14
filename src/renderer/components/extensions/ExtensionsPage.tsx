import type { ExtensionPluginSummary } from '@shared/extensionPlugins/types';
import type { McpServerEntry, PluginEntry, SkillEntry } from '@shared/types';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileArchive,
  FileCode2,
  FolderOpen,
  HardDriveDownload,
  Info,
  Link2,
  MoreHorizontal,
  Plug,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/chat/ConfirmDialog';
import { LocalAssetImportDialog } from '@/components/settings/LocalAssetImportDialog';
import { McpEditDialog } from '@/components/settings/McpEditDialog';
import { PluginMarket } from '@/components/settings/PluginMarket';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import {
  Sheet,
  SheetClose,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import {
  NativePluginFlows,
  PLUGIN_TRUST_WARNING,
  PluginRegistryAlert,
} from '@/plugins/NativePluginFlows';
import { PluginIcon } from '@/plugins/PluginIcon';
import { PluginManagementDetails } from '@/plugins/PluginManagementDetails';
import { isNativePluginUrl, useNativePluginManager } from '@/plugins/useNativePluginManager';
import { useMcpStatusStore } from '@/stores/mcpStatus';
import { useSettingsStore } from '@/stores/settings';
import {
  EXTENSION_KINDS,
  type ExtensionCatalogEntry,
  type ExtensionFilter,
  filterExtensionCatalog,
  mcpExtensionStatus,
  resolveExtensionEmptyState,
} from './extensionCatalog';

const presentation = {
  skill: { label: 'Skills', icon: FileCode2 },
  mcp: { label: 'MCP connections', icon: Plug },
  plugin: { label: 'Plugins', icon: Puzzle },
} as const;

type Entry = ExtensionCatalogEntry &
  (
    | { kind: 'skill'; skill: SkillEntry }
    | { kind: 'mcp'; server: McpServerEntry }
    | { kind: 'plugin'; plugin: ExtensionPluginSummary }
    | { kind: 'plugin'; claudePlugin: PluginEntry }
  );

const entryKey = (entry: Entry) =>
  `${entry.kind}:${'claudePlugin' in entry ? 'claude:' : ''}${entry.id}`;

const NEW_SESSION_NOTE =
  'Changes apply to new conversations. The current conversation keeps what it already loaded.';

function EntryStatus({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5',
        (status === 'Connected' || status === 'Enabled') && 'text-success',
        (status === 'Not authorized' || status === 'Pending permission approval') &&
          'text-warning-foreground',
        (status === 'Connection failed' || status === 'Plugin crashed') && 'text-destructive'
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      <span className="truncate">{t(status)}</span>
    </span>
  );
}

/**
 * 原生插件用安装包清单里的图标（经 asset 通道读本地文件，停用/崩溃也读得到）；
 * 技能、MCP 和 Claude Code 插件没有原生图标，保持各自的默认图标。
 */
function EntryIcon({ entry, className }: { entry: Entry; className: string }) {
  if (entry.kind === 'plugin' && 'plugin' in entry)
    return (
      <PluginIcon
        pluginId={entry.plugin.id}
        icon={entry.plugin.icon}
        className={cn(className, 'object-contain')}
      />
    );
  const Icon = presentation[entry.kind].icon;
  return <Icon aria-hidden className={className} />;
}

function ExtensionItem({ entry, onOpen }: { entry: Entry; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      data-slot="extension-item"
      data-kind={entry.kind}
      onClick={onOpen}
      className="group flex min-h-[86px] min-w-0 items-start gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-accent/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/80">
        <EntryIcon entry={entry} className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold text-sm" title={entry.name}>
            {entry.name}
          </span>
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </span>
        <span className="mt-1 block truncate text-muted-foreground text-xs">
          {entry.description || t(presentation[entry.kind].label)}
        </span>
        <span className="mt-1.5 flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
          <span className="shrink-0 truncate" title={t(entry.source)}>
            {entry.version || t(entry.source)}
          </span>
          <EntryStatus status={entry.status} />
        </span>
      </span>
    </button>
  );
}

export interface ExtensionPageRequest {
  serial: number;
  pluginId?: string;
  pluginInstallUrl?: string;
}

export function ExtensionsPage({
  onBack,
  request,
}: {
  onBack: () => void;
  request?: ExtensionPageRequest;
}) {
  const { t, locale } = useI18n();
  const authorGuideTitle = locale === 'zh' ? '开发自己的插件' : 'Build your own plugin';
  const native = useNativePluginManager();
  const skills = useSettingsStore((state) => state.skills);
  const mcpServers = useSettingsStore((state) => state.mcpServers);
  const claudePlugins = useSettingsStore((state) => state.plugins);
  const updateSkill = useSettingsStore((state) => state.updateSkill);
  const updateMcp = useSettingsStore((state) => state.updateMcpServer);
  const setClaudePlugin = useSettingsStore((state) => state.setPluginEnabled);
  const removeSkill = useSettingsStore((state) => state.removeSkill);
  const removeMcp = useSettingsStore((state) => state.removeMcpServer);
  const mcpStatuses = useMcpStatusStore((state) => state.statuses);
  const authorized = useMcpStatusStore((state) => state.authorized);
  const authorizing = useMcpStatusStore((state) => state.pending);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ExtensionFilter>('all');
  const [selection, setSelection] = useState<string | null>(null);
  const [assetImport, setAssetImport] = useState<'skill' | 'mcp' | null>(null);
  const [mcpEdit, setMcpEdit] = useState<McpServerEntry | 'new' | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ kind: 'skill' | 'mcp'; id: string } | null>(
    null
  );
  const [urlOpen, setUrlOpen] = useState(false);
  const [authorGuideOpen, setAuthorGuideOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [marketOpen, setMarketOpen] = useState(false);
  const [syncNotice, setSyncNotice] = useState(false);
  const pluginAutoUpdate = useSettingsStore((state) => state.pluginAutoUpdate);
  const setPluginAutoUpdate = useSettingsStore((state) => state.setPluginAutoUpdate);
  const consumedRequest = useRef<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const changeSkillEnabled = (id: string, enabled: boolean) => {
    updateSkill(id, { enabled });
    setSyncNotice(true);
  };
  const changeMcpEnabled = (id: string, enabled: boolean) => {
    updateMcp(id, { enabled });
    setSyncNotice(true);
  };

  useEffect(() => useMcpStatusStore.getState().bind(), []);

  // 市场与管理互为独立视图：切换后把唯一内容滚动区归零，避免带着市场底部的位置回到管理页。
  // biome-ignore lint/correctness/useExhaustiveDependencies: marketOpen 只是重发的触发器，滚动容器由 ref 读
  useEffect(() => {
    const content = contentRef.current;
    if (content) content.scrollTop = 0;
  }, [marketOpen]);

  useEffect(() => {
    if (!request || consumedRequest.current === request.serial || !native.canManage || native.busy)
      return;
    if (request.pluginId && native.loading) return;
    consumedRequest.current = request.serial;
    setQuery('');
    setFilter('plugin');
    if (request.pluginId) setMarketOpen(false);
    if (request.pluginInstallUrl) {
      void native.stage('url', request.pluginInstallUrl);
    } else if (
      request.pluginId &&
      native.plugins.some((plugin) => plugin.id === request.pluginId)
    ) {
      setSelection(`plugin:${request.pluginId}`);
    }
  }, [request, native.canManage, native.busy, native.loading, native.plugins, native.stage]);

  const catalog: Entry[] = [
    ...skills.map(
      (skill): Entry => ({
        kind: 'skill',
        id: skill.id,
        name: skill.name,
        description: skill.description,
        source: skill.source,
        status: skill.enabled ? 'Enabled' : 'Disabled',
        skill,
      })
    ),
    ...mcpServers.map(
      (server): Entry => ({
        kind: 'mcp',
        id: server.id,
        name: server.name,
        description: server.description ?? '',
        source: server.source,
        status: mcpExtensionStatus(
          server.enabled,
          (mcpStatuses[server.id] ?? mcpStatuses[server.name])?.state
        ),
        server,
      })
    ),
    ...native.plugins.map(
      (plugin): Entry => ({
        kind: 'plugin',
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        source: 'Collabra plugins',
        version: plugin.version,
        status: plugin.pendingVersion
          ? 'Pending permission approval'
          : plugin.state === 'crashed'
            ? 'Plugin crashed'
            : plugin.state === 'enabled'
              ? 'Enabled'
              : 'Disabled',
        plugin,
      })
    ),
    ...claudePlugins.map(
      (plugin): Entry => ({
        kind: 'plugin',
        id: plugin.id,
        name: plugin.name,
        description: plugin.description ?? '',
        source: plugin.source,
        version: plugin.version,
        status: plugin.enabled ? 'Enabled' : 'Disabled',
        claudePlugin: plugin,
      })
    ),
  ];
  const visible = filterExtensionCatalog(
    catalog.map((entry) => ({ ...entry, source: t(entry.source) })),
    filter,
    query
  );
  const selected = catalog.find((entry) => entryKey(entry) === selection);
  const installDisabled = !native.canManage || Boolean(native.busy);
  const showingPlugins = filter === 'all' || filter === 'plugin';
  const emptyState =
    visible.length || (showingPlugins && (native.loading || native.registryError))
      ? null
      : resolveExtensionEmptyState({
          total: catalog.length,
          visible: visible.length,
          filter,
          query,
        });
  const closeDetail = () => setSelection(null);
  const plugin = selected && 'plugin' in selected ? selected.plugin : undefined;
  const selectedMcp = selected?.kind === 'mcp' ? selected.server : undefined;
  const selectedMcpStatus =
    selectedMcp && (mcpStatuses[selectedMcp.id] ?? mcpStatuses[selectedMcp.name]);

  return (
    <main
      data-slot="extensions-page"
      className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel"
    >
      {/* 标题与顶部操作常驻滚动区之外，窄宽时自行换行；正文只有下面这一个纵向滚动区。 */}
      <div
        data-slot="extensions-header"
        className="shrink-0 border-line border-b bg-panel pt-5 pb-3"
      >
        <div className="mx-auto w-full max-w-[1104px] px-5 sm:px-8">
          <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0 grow basis-[calc(240rem/14)]">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 mb-1.5 text-muted-foreground"
                onClick={onBack}
              >
                <ArrowLeft />
                {t('Back to conversation')}
              </Button>
              <h1 className="font-semibold text-[calc(24rem/14)] tracking-tight">
                {t('Extensions')}
              </h1>
              <p className="mt-1 text-muted-foreground text-sm">
                {t('Manage your skills, MCP connections, and installed plugins.')}
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              <Menu>
                <MenuTrigger render={<Button size="sm" />}>
                  <Plus />
                  {t('Add extension')}
                  <ChevronDown className="size-3.5" />
                </MenuTrigger>
                <MenuPopup align="end" className="w-max">
                  <MenuItem
                    data-install-source="dir"
                    disabled={installDisabled}
                    onClick={() => void native.stage('dir')}
                  >
                    <FolderOpen />
                    {t('Install plugin from folder')}
                  </MenuItem>
                  <MenuItem
                    data-install-source="zip"
                    disabled={installDisabled}
                    onClick={() => void native.stage('zip')}
                  >
                    <FileArchive />
                    {t('Install plugin from ZIP')}
                  </MenuItem>
                  <MenuItem
                    data-install-source="url"
                    disabled={installDisabled}
                    onClick={() => {
                      setUrl('');
                      setUrlOpen(true);
                    }}
                  >
                    <Link2 />
                    {t('Install plugin from link')}
                  </MenuItem>
                  <MenuItem onClick={() => setAuthorGuideOpen(true)}>
                    <FileCode2 />
                    {authorGuideTitle}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem onClick={() => setAssetImport('skill')}>
                    <HardDriveDownload />
                    {t('Import skills from local apps')}
                  </MenuItem>
                  <MenuItem onClick={() => setMcpEdit('new')}>
                    <Plug />
                    {t('Add MCP server')}
                  </MenuItem>
                  <MenuItem onClick={() => setAssetImport('mcp')}>
                    <HardDriveDownload />
                    {t('Import MCP servers')}
                  </MenuItem>
                </MenuPopup>
              </Menu>
              <Button
                size="sm"
                variant={marketOpen ? 'secondary' : 'outline'}
                onClick={() => setMarketOpen((open) => !open)}
              >
                {t(marketOpen ? 'Back to installed' : 'Browse plugin market')}
              </Button>
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label={t('More extension actions')}
                    />
                  }
                >
                  <MoreHorizontal />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuItem
                    disabled={!native.canManage || !!native.busy}
                    onClick={() => void native.checkUpdates()}
                  >
                    <RefreshCw />
                    {t('Check plugin updates')}
                  </MenuItem>
                  <MenuCheckboxItem
                    checked={pluginAutoUpdate}
                    onCheckedChange={setPluginAutoUpdate}
                  >
                    {t('Automatically update plugins')}
                  </MenuCheckboxItem>
                </MenuPopup>
              </Menu>
            </div>
          </header>
        </div>
      </div>
      <div
        ref={contentRef}
        data-slot="extensions-content"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-[1104px] space-y-4 px-5 py-5 sm:px-8">
          {/* 市场与管理是互斥视图；插件操作的失败提示两者都要可见，所以留在切换之外。 */}
          {native.error && (
            <p role="alert" className="break-words text-destructive text-sm">
              {native.error}
            </p>
          )}
          {marketOpen ? (
            <PluginMarket manager={native} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[180px] max-w-[280px] flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label={t('Search extensions')}
                    placeholder={t('Search extensions')}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="bg-muted/60 [&_input]:pr-8 [&_input]:pl-8"
                  />
                  {query && (
                    <button
                      type="button"
                      aria-label={t('Clear search')}
                      className="absolute inset-y-0 right-1 flex w-7 items-center justify-center text-muted-foreground hover:text-foreground"
                      onClick={() => setQuery('')}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
                <Tabs
                  value={filter}
                  onValueChange={(value) => {
                    if (
                      value === 'all' ||
                      value === 'skill' ||
                      value === 'mcp' ||
                      value === 'plugin'
                    )
                      setFilter(value);
                  }}
                >
                  <TabsList aria-label={t('Extension type')}>
                    <TabsTab value="all">{t('All')}</TabsTab>
                    <TabsTab value="skill">{t('Skills')}</TabsTab>
                    <TabsTab value="mcp">MCP</TabsTab>
                    <TabsTab value="plugin">{t('Plugins')}</TabsTab>
                  </TabsList>
                </Tabs>
              </div>
              {syncNotice && (
                <div
                  data-slot="extension-notice"
                  role="status"
                  className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-muted-foreground text-xs"
                >
                  <Info className="mt-px size-3.5 shrink-0" />
                  <span>{t(NEW_SESSION_NOTE)}</span>
                </div>
              )}
              {showingPlugins && native.registryError && (
                <PluginRegistryAlert error={native.registryError} />
              )}
              {showingPlugins && native.loading && (
                <div
                  role="status"
                  className="flex items-center gap-2 text-muted-foreground text-sm"
                >
                  <Spinner />
                  {t('Loading plugins…')}
                </div>
              )}
              {visible.length
                ? EXTENSION_KINDS.map((kind) => {
                    const entries = visible.filter((entry) => entry.kind === kind);
                    if (!entries.length) return null;
                    return (
                      <section key={kind} aria-label={t(presentation[kind].label)}>
                        <div className="flex items-baseline gap-2 border-line border-b pb-2.5">
                          <h2 className="font-semibold text-sm">{t(presentation[kind].label)}</h2>
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {entries.length}
                          </span>
                        </div>
                        <div className="-mx-2.5 mt-2 grid gap-x-4 gap-y-1 @min-[540px]:grid-cols-2 @min-[860px]:grid-cols-3">
                          {entries.map((entry) => (
                            <ExtensionItem
                              key={entryKey(entry)}
                              entry={entry}
                              onOpen={() => setSelection(entryKey(entry))}
                            />
                          ))}
                        </div>
                      </section>
                    );
                  })
                : emptyState && (
                    <div
                      data-slot="extensions-empty"
                      className="rounded-xl border border-line border-dashed px-5 py-10 text-center"
                    >
                      {emptyState === 'first-run' ? (
                        <Puzzle className="mx-auto size-6 text-muted-foreground" />
                      ) : (
                        <Search className="mx-auto size-6 text-muted-foreground" />
                      )}
                      <p className="mt-3 font-medium text-sm">
                        {t(
                          emptyState === 'first-run'
                            ? 'Add your first extension'
                            : emptyState === 'no-results'
                              ? 'No results'
                              : 'No extensions in this category'
                        )}
                      </p>
                      <p className="mt-1 text-muted-foreground text-xs">
                        {t(
                          emptyState === 'first-run'
                            ? 'Skills, MCP connections, and plugins you install appear here.'
                            : emptyState === 'no-results'
                              ? 'Try another search term.'
                              : 'Use Add extension to import a skill, connect MCP, or install a plugin.'
                        )}
                      </p>
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        {emptyState === 'first-run' ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setAssetImport('skill')}
                            >
                              <HardDriveDownload />
                              {t('Import skills')}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setMcpEdit('new')}>
                              <Plug />
                              {t('Connect MCP')}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={installDisabled}
                              onClick={() => void native.stage('dir')}
                            >
                              <FolderOpen />
                              {t('Install plugin')}
                            </Button>
                          </>
                        ) : (
                          <>
                            {query.trim() && (
                              <Button size="sm" variant="outline" onClick={() => setQuery('')}>
                                {t('Clear search')}
                              </Button>
                            )}
                            {filter !== 'all' && (
                              <Button size="sm" variant="outline" onClick={() => setFilter('all')}>
                                {t('Show all extensions')}
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
            </>
          )}
        </div>
      </div>

      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) closeDetail();
        }}
      >
        {selected && (
          <SheetPopup showCloseButton={false} className="max-w-[450px]">
            <SheetHeader>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs">
                  {t(presentation[selected.kind].label)}
                </span>
                <SheetClose
                  aria-label={t('Close')}
                  render={<Button variant="ghost" size="icon-sm" />}
                >
                  <X />
                </SheetClose>
              </div>
              <SheetTitle className="flex items-center gap-2 break-words font-semibold">
                {plugin?.icon && (
                  <PluginIcon
                    pluginId={plugin.id}
                    icon={plugin.icon}
                    className="size-6 shrink-0 object-contain"
                  />
                )}
                <span className="min-w-0 break-words">{selected.name}</span>
              </SheetTitle>
              <SheetDescription>{selected.description || t(selected.source)}</SheetDescription>
            </SheetHeader>
            <SheetPanel className="space-y-5">
              <dl className="grid grid-cols-2 gap-4 border-line border-y py-4 text-sm">
                <div>
                  <dt className="mb-1 text-muted-foreground text-xs">{t('Source')}</dt>
                  <dd className="break-words">{t(selected.source)}</dd>
                </div>
                <div>
                  <dt className="mb-1 text-muted-foreground text-xs">{t('Status')}</dt>
                  <dd>
                    <EntryStatus status={selected.status} />
                  </dd>
                </div>
                {selected.version && (
                  <div>
                    <dt className="mb-1 text-muted-foreground text-xs">{t('Version')}</dt>
                    <dd>{selected.version}</dd>
                  </div>
                )}
              </dl>
              {selected.kind === 'skill' && (
                <>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span>{t('Enabled')}</span>
                    <Switch
                      aria-label={t('Enabled')}
                      checked={selected.skill.enabled}
                      onCheckedChange={(enabled) => changeSkillEnabled(selected.id, enabled)}
                    />
                  </div>
                  <p className="text-muted-foreground text-xs">{t(NEW_SESSION_NOTE)}</p>
                  <div className="space-y-2">
                    <h3 className="font-semibold text-sm">{t('Use in conversation')}</h3>
                    <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
                      <code className="min-w-0 flex-1 break-all text-xs">
                        /skill:{selected.name}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void navigator.clipboard.writeText(`/skill:${selected.name}`).then(
                            () => addToast({ type: 'success', title: t('Copied') }),
                            () => addToast({ type: 'error', title: t('Copy failed') })
                          );
                        }}
                      >
                        {t('Copy command')}
                      </Button>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {t('Start a new conversation to use newly enabled skills.')}
                    </p>
                  </div>
                  <p className="break-all text-muted-foreground text-xs">{selected.skill.path}</p>
                </>
              )}
              {selectedMcp && (
                <>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span>{t('Enabled')}</span>
                    <Switch
                      aria-label={t('Enabled')}
                      checked={selectedMcp.enabled}
                      onCheckedChange={(enabled) => changeMcpEnabled(selectedMcp.id, enabled)}
                    />
                  </div>
                  <p className="text-muted-foreground text-xs">{t(NEW_SESSION_NOTE)}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        closeDetail();
                        setMcpEdit(selectedMcp);
                      }}
                    >
                      {t('Edit')}
                    </Button>
                    {((selectedMcp.transport !== 'stdio' && !authorized[selectedMcp.id]) ||
                      selectedMcpStatus?.state === 'unauthorized') && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={authorizing[selectedMcp.id]}
                        onClick={() => void useMcpStatusStore.getState().authorize(selectedMcp.id)}
                      >
                        {t(authorizing[selectedMcp.id] ? 'Authorizing' : 'Authorize')}
                      </Button>
                    )}
                    {authorized[selectedMcp.id] && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void useMcpStatusStore
                            .getState()
                            .revoke(selectedMcp.id)
                            .catch(() =>
                              addToast({
                                type: 'error',
                                title: t('Could not revoke authorization'),
                              })
                            );
                        }}
                      >
                        {t('Revoke authorization')}
                      </Button>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {selectedMcp.transport.toUpperCase()} ·{' '}
                    {t(selectedMcp.loadMode === 'deferred' ? 'On demand' : 'Always loaded')}
                  </p>
                </>
              )}
              {plugin && (
                <>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span>{t('Enabled')}</span>
                    <Switch
                      aria-label={t('Enabled')}
                      checked={plugin.state === 'enabled'}
                      disabled={installDisabled}
                      onCheckedChange={(enabled) => void native.setEnabled(plugin.id, enabled)}
                    />
                  </div>
                  <p className="break-all font-mono text-muted-foreground text-xs">{plugin.id}</p>
                  <PluginManagementDetails plugin={plugin} manager={native} />
                  <div className="space-y-2">
                    <h3 className="font-semibold text-sm">{t('Permissions')}</h3>
                    <p className="break-words text-muted-foreground text-xs">
                      {plugin.permissions.join(' · ') || t('No declared host permissions')}
                    </p>
                    <p className="rounded-lg bg-warning/10 p-3 text-xs leading-relaxed">
                      {t(PLUGIN_TRUST_WARNING)}
                    </p>
                  </div>
                  {plugin.pendingVersion && (
                    <div className="space-y-2 rounded-lg border border-warning/30 p-3 text-sm">
                      <p>
                        {t('Pending update requires explicit permission approval')}:{' '}
                        {plugin.pendingVersion}
                      </p>
                      <p className="break-all font-mono text-xs">
                        {plugin.pendingPermissions?.join(' · ')}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={installDisabled}
                          onClick={() => void native.approvePending(plugin.id)}
                        >
                          {t('Approve update permissions')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={installDisabled}
                          onClick={() => void native.rejectPending(plugin.id)}
                        >
                          {t('Keep current')}
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {plugin.configurable && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!native.available || !!native.busy}
                        onClick={() => {
                          closeDetail();
                          native.configure(plugin.id);
                        }}
                      >
                        {t('Configure')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={installDisabled}
                      onClick={() => {
                        closeDetail();
                        native.uninstall(plugin.id);
                      }}
                    >
                      {t('Uninstall')}
                    </Button>
                  </div>
                  {native.error && (
                    <p role="alert" className="break-words text-destructive text-sm">
                      {native.error}
                    </p>
                  )}
                </>
              )}
              {'claudePlugin' in selected && (
                <>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span>{t('Enabled')}</span>
                    <Switch
                      aria-label={t('Enabled')}
                      checked={selected.claudePlugin.enabled}
                      onCheckedChange={(enabled) => setClaudePlugin(selected.id, enabled)}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void window.electronAPI.window.openSettings({
                        category: 'plugins',
                        rowId: 'plugins.root',
                      })
                    }
                  >
                    {t('Manage Claude Code plugins')}
                  </Button>
                </>
              )}
              {(selected.kind === 'skill' || selected.kind === 'mcp') && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setRemoveTarget({ kind: selected.kind, id: selected.id });
                    closeDetail();
                  }}
                >
                  {t('Remove')}
                </Button>
              )}
            </SheetPanel>
          </SheetPopup>
        )}
      </Sheet>

      {assetImport && (
        <LocalAssetImportDialog
          kind={assetImport}
          open
          onOpenChange={(open) => {
            if (!open) setAssetImport(null);
          }}
        />
      )}
      {mcpEdit && <McpEditDialog server={mcpEdit} onClose={() => setMcpEdit(null)} />}
      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={t('Remove extension?')}
        description={t('This removes the entry from Collabra without deleting the original files.')}
        confirmLabel={t('Remove')}
        onConfirm={() => {
          if (removeTarget?.kind === 'skill') removeSkill(removeTarget.id);
          if (removeTarget?.kind === 'mcp') removeMcp(removeTarget.id);
        }}
      />
      <Dialog open={urlOpen} onOpenChange={setUrlOpen}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (installDisabled || !isNativePluginUrl(url)) return;
              setUrlOpen(false);
              void native.stage('url', url);
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('Install plugin from link')}</DialogTitle>
              <DialogDescription>
                {t(
                  'Enter an HTTPS ZIP link. You will review the plugin and its permissions before installing.'
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <Input
                type="url"
                required
                aria-label={t('Plugin URL')}
                placeholder="https://example.com/plugin.zip"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setUrlOpen(false)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={installDisabled || !isNativePluginUrl(url)}>
                {t('Preview URL')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={authorGuideOpen} onOpenChange={setAuthorGuideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{authorGuideTitle}</DialogTitle>
            <DialogDescription>
              {locale === 'zh'
                ? '在Collabra源码目录运行以下命令。校验不会执行插件代码。'
                : 'Run these commands from a Collabra source checkout. Validation does not run plugin code.'}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
              <code>
                {
                  'pnpm plugin:init ./my-plugin --id local.myplugin\npnpm plugin:validate ./my-plugin'
                }
              </code>
            </pre>
            <p className="mt-3 text-muted-foreground text-sm">
              {locale === 'zh'
                ? '校验通过后，从「添加扩展 → 从文件夹安装插件」选择生成的目录，查看权限并确认「安装并启用」；首次安装确认后即启用，之后可随时停用。'
                : 'After validation, choose Add extension → Install plugin from folder. Review permissions and confirm with Install and enable: a first install is enabled as soon as you confirm, and you can turn it off anytime.'}
            </p>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{t('Close')}</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <NativePluginFlows manager={native} />
    </main>
  );
}
