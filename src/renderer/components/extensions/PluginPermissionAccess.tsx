import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Bell,
  Bot,
  Clipboard,
  ExternalLink,
  FolderOpen,
  Globe,
  Info,
  LayoutGrid,
  ListChecks,
  LockKeyhole,
  MessageSquare,
  MessageSquareText,
  PanelsTopLeft,
  Plug,
  ScanSearch,
  Server,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  SquarePen,
  Terminal,
  TriangleAlert,
} from 'lucide-react';
import { type CSSProperties, Fragment, type ReactNode, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { PLUGIN_TRUST_WARNING } from '@/plugins/NativePluginFlows';
import {
  knownPermission,
  PERMISSION_GROUPS,
  type PermissionGroup,
  type PermissionRisk,
} from './PluginPermissionAccessCatalog';

export interface PluginPermissionAccessProps {
  pluginName: string;
  permissions: readonly string[];
  mode: 'available' | 'installed' | 'update';
  pendingVersion?: string;
  crossSession?: { enabled: boolean; disabled: boolean; onChange(enabled: boolean): void };
  versionSwitcher?: ReactNode;
  onBack(): void;
}

const groupInfo = {
  interface: {
    icon: LayoutGrid,
    title: 'Interface & input',
    description: 'Controls and content in the app interface.',
  },
  project: {
    icon: FolderOpen,
    title: 'Project data',
    description: 'Project files accessed through CodeKiln.',
  },
  session: {
    icon: MessageSquare,
    title: 'Sessions & agent events',
    description: 'Conversation state, agent activity, and intervention.',
  },
  execution: {
    icon: Terminal,
    title: 'Tools & execution',
    description: 'Plugin tools, external processes, and model runs.',
  },
  external: {
    icon: Globe,
    title: 'Network & browser',
    description: 'Host requests and browser actions.',
  },
  unknown: {
    icon: ShieldQuestion,
    title: 'Unclassified permissions',
    description: 'Identifiers not recognized by this CodeKiln version.',
  },
} satisfies Record<PermissionGroup, { icon: typeof Plug; title: string; description: string }>;

const riskInfo = {
  low: { icon: ShieldCheck, label: 'Low risk', color: 'bg-secondary text-muted-foreground' },
  medium: { icon: ShieldAlert, label: 'Medium risk', color: 'bg-warning/15 text-foreground' },
  high: { icon: TriangleAlert, label: 'High risk', color: 'bg-destructive/10 text-destructive' },
  unknown: {
    icon: ShieldQuestion,
    label: 'Unclassified',
    color: 'bg-secondary text-muted-foreground',
  },
} satisfies Record<PermissionRisk | 'unknown', { icon: typeof Plug; label: string; color: string }>;

const flowEndpoints = {
  plugin: { icon: Plug, label: 'Plugin' },
  interface: { icon: PanelsTopLeft, label: 'App interface' },
  notifications: { icon: Bell, label: 'System notifications' },
  draft: { icon: SquarePen, label: 'Conversation draft' },
  files: { icon: FolderOpen, label: 'Project files' },
  network: { icon: Globe, label: 'Remote host' },
  mcp: { icon: Server, label: 'MCP service' },
  agent: { icon: Bot, label: 'Agent' },
  process: { icon: Terminal, label: 'Background tasks' },
  plugins: { icon: Plug, label: 'Other plugins' },
  clipboard: { icon: Clipboard, label: 'System clipboard' },
  systemBrowser: { icon: ExternalLink, label: 'System browser' },
  sessions: { icon: MessageSquareText, label: 'Conversations' },
  model: { icon: Sparkles, label: 'Model service' },
  browser: { icon: Globe, label: 'Built-in browser' },
};

type PermissionItem = { id: string; info: ReturnType<typeof knownPermission> };

function PermissionFlow({ flow }: { flow: NonNullable<PermissionItem['info']>['flow'] }) {
  const { t } = useI18n();
  const [endpoint, direction] = flow;
  const endpoints =
    direction === 'receive' ? ([endpoint, 'plugin'] as const) : (['plugin', endpoint] as const);
  const FlowArrow = direction === 'exchange' ? ArrowLeftRight : ArrowRight;
  return (
    <figure className="space-y-1.5">
      <div className="grid min-h-27 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-border bg-secondary/35 px-2.5 py-4">
        {endpoints.map((key, index) => {
          const { icon: Icon, label } = flowEndpoints[key];
          return (
            <Fragment key={key}>
              {index === 1 && (
                <FlowArrow
                  className="size-4 text-muted-foreground"
                  aria-label={t(
                    direction === 'exchange'
                      ? 'Exchanges data or actions with'
                      : 'Sends data or actions to'
                  )}
                />
              )}
              <div className="flex min-w-0 flex-col items-center gap-1.5 text-center text-muted-foreground text-xs [overflow-wrap:anywhere]">
                <span className="grid size-9 place-items-center rounded-lg border border-border bg-secondary text-foreground">
                  <Icon aria-hidden className="size-4.5" />
                </span>
                {t(label)}
              </div>
            </Fragment>
          );
        })}
      </div>
      <figcaption className="text-muted-foreground text-xs">{t('Host capability flow')}</figcaption>
    </figure>
  );
}

function PermissionInspector({ item, id }: { item: PermissionItem; id: string }) {
  const { t } = useI18n();
  const { info } = item;
  const risk = riskInfo[info?.risk ?? 'unknown'];
  return (
    <aside
      id={id}
      aria-labelledby={`${id}-title`}
      className="min-w-0 self-start space-y-3.5 rounded-xl border border-border p-3.5 @min-[42rem]:sticky @min-[42rem]:top-4 @min-[42rem]:col-start-2 @min-[42rem]:[grid-row:1/-1] @min-[42rem]:rounded-none @min-[42rem]:border-0 @min-[42rem]:border-l @min-[42rem]:py-0 @min-[42rem]:pr-0 @min-[42rem]:pl-5"
    >
      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
          <ScanSearch aria-hidden className="size-3.5" />
          {t(info ? 'Host capability details' : 'Unknown capability details')}
        </p>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3
            id={`${id}-title`}
            className="min-w-0 font-semibold text-base [overflow-wrap:anywhere]"
          >
            {info ? t(info.label) : item.id}
          </h3>
          <span className={cn('rounded-full px-2 py-0.5 font-medium text-xs', risk.color)}>
            {t(risk.label)}
          </span>
        </div>
        {info && (
          <code className="block font-mono text-muted-foreground text-xs [overflow-wrap:anywhere]">
            {item.id}
          </code>
        )}
      </div>
      {info ? (
        <>
          <PermissionFlow flow={info.flow} />
          <dl className="divide-y divide-border border-border border-y text-xs leading-relaxed">
            <div className="py-2.5">
              <dt className="flex items-center gap-1.5 font-medium">
                <ScanSearch aria-hidden className="size-3.5 text-muted-foreground" />
                {t('Access scope')}
              </dt>
              <dd className="mt-1 text-muted-foreground">{t(info.scope)}</dd>
            </div>
            <div className="py-2.5">
              <dt className="flex items-center gap-1.5 font-medium">
                <ListChecks aria-hidden className="size-3.5 text-muted-foreground" />
                {t('What this permission enables')}
              </dt>
              <dd className="mt-1 text-muted-foreground">{t(info.summary)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t(
            'This CodeKiln version does not describe the scope, effect, or risk of this declaration.'
          )}
        </p>
      )}
    </aside>
  );
}

function PermissionRow({
  item,
  selected,
  inspectorId,
  onSelect,
  crossSession,
}: {
  item: PermissionItem;
  selected: boolean;
  inspectorId: string;
  onSelect(): void;
  crossSession?: PluginPermissionAccessProps['crossSession'];
}) {
  const { t } = useI18n();
  const crossSessionLabelId = useId();
  const { info } = item;
  const risk = riskInfo[info?.risk ?? 'unknown'];
  const RiskIcon = risk.icon;
  return (
    <li className={cn(selected && 'bg-selection text-selection-foreground')}>
      <button
        type="button"
        aria-pressed={selected}
        aria-controls={selected ? inspectorId : undefined}
        onClick={onSelect}
        className={cn(
          'flex w-full min-w-0 items-start gap-2.5 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          !selected && 'hover:bg-accent'
        )}
      >
        <span
          title={t(risk.label)}
          className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg', risk.color)}
        >
          <RiskIcon aria-hidden className="size-3.5" />
          <span className="sr-only">{t(risk.label)}</span>
        </span>
        <span className="min-w-0 space-y-0.5 [overflow-wrap:anywhere]">
          {info && <span className="block font-medium text-sm">{t(info.label)}</span>}
          <code
            className={cn(
              'block font-mono text-xs',
              info ? 'text-muted-foreground' : 'font-medium'
            )}
          >
            {item.id}
          </code>
          <span className="block text-muted-foreground text-xs leading-relaxed">
            {t(info?.summary ?? 'No host capability description is available.')}
          </span>
        </span>
      </button>
      {crossSession && (
        <div className="flex items-center justify-between gap-3 pb-2.5 pl-12 pr-3 text-muted-foreground text-xs">
          <span id={crossSessionLabelId}>{t('Allow injection into other sessions')}</span>
          <Switch
            aria-labelledby={crossSessionLabelId}
            checked={crossSession.enabled}
            disabled={crossSession.disabled}
            onCheckedChange={(enabled) => crossSession.onChange(enabled)}
          />
        </div>
      )}
    </li>
  );
}

/** Drawer content: the parent owns navigation, scrolling and any review or permission mutation. */
export function PluginPermissionAccess({
  pluginName,
  permissions,
  mode,
  pendingVersion,
  crossSession,
  versionSwitcher,
  onBack,
}: PluginPermissionAccessProps) {
  const { t } = useI18n();
  const titleId = useId();
  const inspectorId = useId();
  const [selectedId, setSelectedId] = useState<string>();
  const items = [...new Set(permissions)].map((id) => ({ id, info: knownPermission(id) }));
  const groups = PERMISSION_GROUPS.map((group) => ({
    group,
    items: items.filter(({ info }) => (info?.group ?? 'unknown') === group),
  })).filter((group) => group.items.length > 0);
  const selected = items.find(({ id }) => id === selectedId) ?? groups[0]?.items[0];
  const highRiskCount = items.filter(({ info }) => info?.risk === 'high').length;
  const hasUnknown = items.some(({ info }) => !info);
  const status =
    mode === 'installed'
      ? 'Current installation'
      : mode === 'available'
        ? 'Reviewed at installation'
        : pendingVersion && versionSwitcher
          ? 'Pending approval'
          : 'Update candidate';
  const notice =
    mode === 'installed'
      ? t(
          'These permissions describe the installed package. They do not indicate which capabilities are currently in use.'
        )
      : mode === 'available'
        ? t(
            'These permissions are declared by the package. Review the package and its permissions before installing.'
          )
        : t(
            'These are the update candidate’s declarations, not the current installation’s permissions.'
          );

  return (
    <section
      aria-labelledby={titleId}
      data-slot="plugin-permission-access"
      className="@container mx-auto w-full min-w-0 max-w-5xl"
    >
      <header className="flex items-start gap-2.5 border-border border-b pb-4">
        <Button
          size="icon"
          variant="ghost"
          className="-ml-1"
          aria-label={t('Back to extension details')}
          data-slot="permission-access-back"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-foreground">
              <LockKeyhole aria-hidden className="size-4.5" />
            </span>
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <h2 id={titleId} className="font-semibold text-base leading-snug">
                {t('Permission & Data Access')}
              </h2>
              <p className="mt-0.5 text-muted-foreground text-xs">{pluginName}</p>
            </div>
          </div>
          <p className="mt-3 max-w-[80ch] text-muted-foreground text-sm leading-relaxed">
            {t(PLUGIN_TRUST_WARNING)}
          </p>
        </div>
      </header>
      {versionSwitcher && <div className="pt-4">{versionSwitcher}</div>}

      <dl className="grid grid-cols-2 gap-2 py-4 @min-[28rem]:grid-cols-3">
        <div className="min-w-0 rounded-xl bg-secondary/70 px-3 py-2.5">
          <dt className="text-muted-foreground text-xs">{t('Declared permissions')}</dt>
          <dd className="mt-1 font-semibold text-base tabular-nums">{items.length}</dd>
        </div>
        <div className="min-w-0 rounded-xl bg-secondary/70 px-3 py-2.5">
          <dt className="text-muted-foreground text-xs">{t('High risk')}</dt>
          <dd
            className={cn(
              'mt-1 font-semibold text-base tabular-nums',
              highRiskCount > 0 && 'text-destructive'
            )}
          >
            {highRiskCount}
          </dd>
        </div>
        <div className="col-span-2 min-w-0 rounded-xl bg-secondary/70 px-3 py-2.5 @min-[28rem]:col-span-1">
          <dt className="text-muted-foreground text-xs">{t('Access status')}</dt>
          <dd className="mt-1 font-semibold text-base [overflow-wrap:anywhere]">{t(status)}</dd>
        </div>
      </dl>

      <div className="mb-5 flex items-start gap-2 rounded-lg bg-secondary/45 px-3 py-2.5 text-muted-foreground text-xs leading-relaxed">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
          <p>{notice}</p>
          {mode === 'update' && pendingVersion && !versionSwitcher && (
            <p>{t('Candidate version: {{version}}', { version: pendingVersion })}</p>
          )}
          {hasUnknown && (
            <p>{t('Unclassified permissions are not included in the high-risk count.')}</p>
          )}
        </div>
      </div>

      {selected ? (
        <div
          className="grid min-w-0 gap-4 @min-[42rem]:grid-cols-[minmax(0,1fr)_minmax(15rem,0.74fr)] @min-[42rem]:grid-rows-[repeat(var(--permission-groups),auto)] @min-[42rem]:gap-x-5"
          style={{ '--permission-groups': groups.length } as CSSProperties}
        >
          {groups.map(({ group, items: groupItems }) => {
            const { icon: Icon, title, description } = groupInfo[group];
            return (
              <Fragment key={group}>
                <section className="min-w-0 space-y-2 @min-[42rem]:col-start-1">
                  <div className="flex items-start gap-2">
                    <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <h3 className="font-medium text-sm">{t(title)}</h3>
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        {t(description)}
                      </p>
                    </div>
                  </div>
                  <ul className="overflow-hidden rounded-xl border border-border [&>li+li]:border-t [&>li+li]:border-t-border">
                    {groupItems.map((item) => (
                      <PermissionRow
                        key={item.id}
                        item={item}
                        selected={selected.id === item.id}
                        inspectorId={inspectorId}
                        onSelect={() => setSelectedId(item.id)}
                        crossSession={
                          mode === 'installed' && item.id === 'agent.inject'
                            ? crossSession
                            : undefined
                        }
                      />
                    ))}
                  </ul>
                </section>
                {groupItems.includes(selected) && (
                  <PermissionInspector item={selected} id={inspectorId} />
                )}
              </Fragment>
            );
          })}
        </div>
      ) : (
        <p className="rounded-lg border border-border border-dashed px-3 py-5 text-center text-muted-foreground text-sm">
          {t('No declared host permissions')}
        </p>
      )}
    </section>
  );
}
