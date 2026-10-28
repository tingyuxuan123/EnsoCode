import {
  type CatalogEntry,
  type ProjectEntry,
  type ProjectGroupEntry,
  pairProjectDisplayName,
} from '@enso/pair';
import { orderPinned, orderProjectSessions, sortByActivity } from '@shared/pair/drawerOrder';
import {
  ALL_GROUP_ID,
  filterProjectsByGroup,
  sectionsForAllView,
  UNGROUPED_GROUP_ID,
} from '@shared/projectGroups';
import type { RemoteNodeStatus } from '@shared/types/nodes';
import { Archive, ChevronDown, ChevronRight, Pin, Search, SquarePen } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/i18n';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { NodeSwitcher } from './NodeSwitcher';

interface RemoteNodeSidebarProps {
  width: number | undefined;
  node: RemoteNodeStatus;
  catalog: CatalogEntry[];
  pinnedOrder: string[];
  projects: ProjectEntry[];
  groups?: ProjectGroupEntry[];
  activeId: string | null;
  canCreate: boolean;
  onSelect: (id: string) => void;
  onNewConversation: () => void;
}

/**
 * 远程节点侧栏：对方目录按项目分组，置顶/归档分栏（与本机侧栏、手机抽屉同语义）。
 * 只做选择与新建：置顶/归档/重命名/删除协议不支持，不露入口。
 */
export function RemoteNodeSidebar({
  width,
  node,
  catalog,
  pinnedOrder,
  projects,
  groups = [],
  activeId,
  canCreate,
  onSelect,
  onNewConversation,
}: RemoteNodeSidebarProps) {
  const { t, locale } = useI18n();
  const [selectedGroupId, setSelectedGroupId] = useState(ALL_GROUP_ID);
  const [query, setQuery] = useState('');
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const resolvedGroupId =
    selectedGroupId === ALL_GROUP_ID ||
    selectedGroupId === UNGROUPED_GROUP_ID ||
    groups.some((group) => group.id === selectedGroupId)
      ? selectedGroupId
      : ALL_GROUP_ID;
  const archivedIds = projects.filter((project) => project.archived).map((project) => project.id);
  const slicedProjects = filterProjectsByGroup(projects, groups, archivedIds, resolvedGroupId);
  const slicedIdSet = new Set(slicedProjects.map((project) => project.id));
  const q = query.trim().toLowerCase();
  const topLevel = useMemo(
    () => catalog.filter((c) => !c.parentId && (!q || c.title.toLowerCase().includes(q))),
    [catalog, q]
  );
  const pinned = orderPinned(
    topLevel.filter(
      (c) => c.pinned && !c.archived && (!c.projectId || slicedIdSet.has(c.projectId))
    ),
    pinnedOrder
  );
  const archived = sortByActivity(
    topLevel.filter((c) => {
      if (!c.archived) return false;
      if (resolvedGroupId === ALL_GROUP_ID) return true;
      return Boolean(c.projectId && slicedIdSet.has(c.projectId));
    })
  );
  const active = topLevel.filter((c) => !c.archived);
  const known = new Set(projects.map((p) => p.id));
  const orphans = orderProjectSessions(active.filter((c) => !known.has(c.projectId)));

  const row = (c: CatalogEntry, subtitle?: string) => (
    <button
      key={c.id}
      type="button"
      onClick={() => onSelect(c.id)}
      className={cn(
        'group flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[calc(12rem/14)] transition-colors',
        activeId === c.id ? 'bg-brand/10 dark:bg-brand/15' : 'hover:bg-muted/60'
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          c.status === 'running' && 'animate-pulse bg-brand',
          c.status === 'failed' && 'bg-destructive',
          c.status === 'idle' && (c.unread ? 'bg-success' : 'bg-muted-foreground/30')
        )}
      />
      <span className="min-w-0 flex-1 truncate">
        {c.title || t('New conversation')}
        {subtitle && (
          <span className="ml-1.5 text-[calc(11rem/14)] text-muted-foreground">{subtitle}</span>
        )}
      </span>
      {c.updatedAt !== undefined && (
        <span className="shrink-0 text-[calc(11rem/14)] text-muted-foreground/80 tabular-nums">
          {formatRelativeTime(c.updatedAt, locale, nowTick)}
        </span>
      )}
    </button>
  );

  return (
    <aside
      className="flex shrink-0 flex-col overflow-hidden border-line border-t border-r bg-nav"
      style={{ width: width ?? 264 }}
    >
      <div className="shrink-0 px-3 pt-3">
        <button
          type="button"
          onClick={onNewConversation}
          disabled={!canCreate}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-muted/60 text-[calc(13rem/14)] transition-colors hover:bg-muted disabled:opacity-40"
          title={t('New remote conversation')}
        >
          <SquarePen className="h-3.5 w-3.5 text-brand" />
          {t('New remote conversation')}
        </button>
      </div>
      {/* 顶部只在列表上方留一条分隔线 */}
      <div className="shrink-0 px-3 pt-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search conversations...')}
            className="h-8 border-transparent bg-muted/60 text-[calc(11rem/14)] shadow-none ring-brand/15 before:hidden has-focus-visible:border-brand/45 [&_input]:pl-8"
          />
        </div>
      </div>
      {groups.length > 0 && (
        <div className="shrink-0 px-3 pb-2">
          <Select
            items={[
              { value: ALL_GROUP_ID, label: t('All') },
              ...groups
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((group) => ({ value: group.id, label: group.name })),
              { value: UNGROUPED_GROUP_ID, label: t('Ungrouped') },
            ]}
            value={resolvedGroupId}
            onValueChange={(value) => {
              if (value) setSelectedGroupId(value);
            }}
          >
            <SelectTrigger className="w-full" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value={ALL_GROUP_ID}>{t('All')}</SelectItem>
              {groups
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              <SelectItem value={UNGROUPED_GROUP_ID}>{t('Ungrouped')}</SelectItem>
            </SelectPopup>
          </Select>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {!node.hostOnline && catalog.length === 0 && (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground text-sm">
            {node.connected ? t('Remote desktop is offline') : t('Connecting…')}
          </p>
        )}
        {node.hostOnline && projects.length === 0 && (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground text-sm">
            {t('The remote desktop has no projects yet')}
          </p>
        )}

        {pinned.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 px-2 py-2">
              <Pin className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[calc(11rem/14)] text-muted-foreground">{t('Pinned')}</span>
            </div>
            <div className="flex flex-col gap-y-0.5">
              {pinned.map((c) => row(c, c.projectName))}
            </div>
          </div>
        )}

        {(resolvedGroupId === ALL_GROUP_ID && groups.length > 0
          ? sectionsForAllView(projects, groups, archivedIds).flatMap((section) => {
              const foldedSection = folded[`g:${section.groupId}`] === true;
              return [
                { kind: 'header' as const, section, foldedSection },
                ...(foldedSection
                  ? []
                  : section.projects.map((project) => ({ kind: 'project' as const, project }))),
              ];
            })
          : slicedProjects.map((project) => ({ kind: 'project' as const, project }))
        ).map((item) => {
          if (item.kind === 'header') {
            return (
              <button
                key={`hdr-${item.section.groupId}`}
                type="button"
                onClick={() =>
                  setFolded((prev) => ({
                    ...prev,
                    [`g:${item.section.groupId}`]: !prev[`g:${item.section.groupId}`],
                  }))
                }
                className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-[calc(11rem/14)] font-medium text-muted-foreground"
              >
                <ChevronRight
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 transition-transform duration-150',
                    !item.foldedSection && 'rotate-90'
                  )}
                />
                {item.section.group?.emoji && (
                  <span className="shrink-0 text-sm">{item.section.group.emoji}</span>
                )}
                {item.section.group?.color && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: item.section.group.color }}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {item.section.group?.name ?? t('Ungrouped')}
                </span>
                <span className="shrink-0 text-[calc(11rem/14)] text-muted-foreground/70">
                  {item.section.projects.length}
                </span>
              </button>
            );
          }
          const { project } = item;
          const sessions = orderProjectSessions(
            active.filter((c) => c.projectId === project.id && !c.pinned)
          );
          if (q && sessions.length === 0) return null;
          const isFolded = folded[project.id] === true;
          return (
            <div key={project.id}>
              <button
                type="button"
                onClick={() => setFolded((prev) => ({ ...prev, [project.id]: !isFolded }))}
                className="flex h-8 w-full items-center gap-1.5 rounded-md px-1.5 text-left transition-colors hover:bg-muted/60"
              >
                {isFolded ? (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium text-[calc(13rem/14)]">
                  {pairProjectDisplayName(project)}
                </span>
                {project.sshHost && (
                  <span className="shrink-0 rounded bg-muted px-1 font-mono text-[calc(11rem/14)] text-muted-foreground">
                    ssh
                  </span>
                )}
              </button>
              {!isFolded && (
                <div className="ml-3 flex flex-col gap-y-0.5 border-l border-border/60 pl-2">
                  {sessions.length === 0 && (
                    <p className="px-4 py-1.5 text-muted-foreground text-[calc(11rem/14)]">
                      {t('No conversations')}
                    </p>
                  )}
                  {sessions.map((c) => row(c))}
                </div>
              )}
            </div>
          );
        })}

        {orphans.length > 0 && (
          <div>
            <div className="px-2 py-2 font-medium text-sm">{t('Other')}</div>
            <div className="flex flex-col gap-y-0.5">{orphans.map((c) => row(c))}</div>
          </div>
        )}

        {archived.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setArchivedOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/60"
            >
              <Archive className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium text-sm">{t('Archived')}</span>
              <span className="text-[calc(11rem/14)] text-muted-foreground">{archived.length}</span>
            </button>
            {archivedOpen && (
              <div className="flex flex-col gap-y-0.5">
                {archived.map((c) => row(c, c.projectName))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center border-t px-1.5 py-2">
        <NodeSwitcher className="max-w-full" />
      </div>
    </aside>
  );
}
