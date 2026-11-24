import {
  type CatalogEntry,
  type ProjectEntry,
  type ProjectGroupEntry,
  pairProjectDisplayName,
  sshProjectLabel,
} from '@enso/pair';
import { orderProjectSessions, sortByActivity } from '@shared/pair/drawerOrder';
import {
  ALL_GROUP_ID,
  filterProjectsByGroup,
  sectionsForAllView,
  UNGROUPED_GROUP_ID,
} from '@shared/projectGroups';
import {
  Archive,
  ArrowDownWideNarrow,
  ArrowLeft,
  ChevronRight,
  Download,
  EllipsisVertical,
  MonitorSmartphone,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  SquarePen,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Z_INDEX } from '@/lib/z-index';
import {
  COLLAPSED_SESSION_LIMIT,
  nextRevealedExtra,
  prevRevealedExtra,
  shownConversationCount,
} from '@/stores/sessions/sessionSwitchSlots';
import type { StoredDevice } from './deviceList';
import {
  countWaiting,
  cycleStatusFilter,
  filterSessionsByStatus,
  type SessionStatusFilter,
  STATUS_FILTER_LABEL,
} from './drawerStatusFilter';
import { FileDownloads } from './FileDownloads';
import { PhoneSettingsScreen } from './PhoneSettingsScreen';
import type { PushFailureReason } from './push';
import { rowTitleClass, rowTone, StatusGlyph, waitingRowClass } from './StatusGlyph';
import { usePhoneBack } from './usePhoneBack';

interface Props {
  open: boolean;
  docked?: boolean;
  /** Back-opened / cold-open lists are the root, not a route back to the chat. */
  backToConversation?: boolean;
  pinnable?: boolean;
  onTogglePinned?(): void;
  projects: ProjectEntry[];
  groups?: ProjectGroupEntry[];
  catalog: CatalogEntry[];
  activeId: string | null;
  canCreate: boolean;
  devices: StoredDevice[];
  activeDevicePairId: string | null;
  connected: boolean;
  connectionLabel: string;
  deviceReadOnly?: boolean;
  pushEnabled: boolean;
  pushBusy: boolean;
  pushError: PushFailureReason | null;
  pushAvailability: 'ok' | 'needs-install' | 'unsupported';
  pushConfigReady: boolean;
  onTogglePush(next: boolean): void;
  onClose(): void;
  onSelect(sessionId: string): void;
  onNewConversation(projectId: string): void;
  onSwitchDevice(pairId: string): void;
  onAddDevice(): void;
  onRenameDevice(pairId: string, label: string): void;
  onUnpairDevice(pairId: string): void;
}

/** The mobile list is a screen, not a narrow desktop sidebar. Wide layouts can still pin it. */
export function SessionDrawer(props: Props) {
  const {
    open,
    docked = false,
    pinnable = false,
    projects,
    catalog,
    activeId,
    canCreate,
    groups = [],
  } = props;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filter, setFilter] = useState<SessionStatusFilter>('all');
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, number>>({});
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [sessionMenu, setSessionMenu] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState(() => {
    try {
      return localStorage.getItem('enso-phone-selected-project-group') ?? ALL_GROUP_ID;
    } catch {
      return ALL_GROUP_ID;
    }
  });
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(Date.now);
  usePhoneBack(open && !docked && props.backToConversation !== false, props.onClose, 10);
  usePhoneBack(open && settingsOpen, () => setSettingsOpen(false), 30);
  usePhoneBack(open && sessionMenu !== null, () => setSessionMenu(null), 40);
  useEffect(() => {
    if (!open) {
      setSettingsOpen(false);
      setSessionMenu(null);
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60000);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') settingsOpen ? setSettingsOpen(false) : props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, settingsOpen, props.onClose]);

  const groupId =
    selectedGroupId === ALL_GROUP_ID ||
    selectedGroupId === UNGROUPED_GROUP_ID ||
    groups.some((group) => group.id === selectedGroupId)
      ? selectedGroupId
      : ALL_GROUP_ID;
  const archivedProjects = projects
    .filter((project) => project.archived)
    .map((project) => project.id);
  const isArchived = (session: CatalogEntry) =>
    session.archived || archivedProjects.includes(session.projectId);
  const roots = catalog.filter((session) => !session.parentId);
  const active = filterSessionsByStatus(
    roots.filter((session) => !isArchived(session)),
    filter
  );
  const availableProjects = filterProjectsByGroup(projects, groups, archivedProjects, groupId);
  const sections = sectionsForAllView(projects, groups, archivedProjects);
  const knownIds = new Set(projects.map((project) => project.id));
  const orphans = orderProjectSessions(
    active.filter((session) => !knownIds.has(session.projectId))
  );
  const archives = sortByActivity(
    roots.filter((session) => {
      if (!isArchived(session)) return false;
      if (groupId === ALL_GROUP_ID) return true;
      const project = projects.find((item) => item.id === session.projectId);
      return groupId === UNGROUPED_GROUP_ID
        ? !project?.groupId || !groups.some((group) => group.id === project.groupId)
        : project?.groupId === groupId;
    })
  );
  const device = props.devices.find((item) => item.pairId === props.activeDevicePairId);
  const waiting = countWaiting(roots.filter((session) => !isArchived(session)));
  const menuEntry = catalog.find((item) => item.id === sessionMenu);
  const newProject = availableProjects[0] ?? projects.find((project) => !project.archived);
  const renderProject = (project: ProjectEntry) => {
    const sessions = orderProjectSessions(
      active.filter((session) => session.projectId === project.id)
    );
    if (filter !== 'all' && sessions.length === 0) return null;
    return (
      <ProjectList
        key={project.id}
        name={pairProjectDisplayName(project)}
        badge={sshProjectLabel(project)}
        sessions={sessions}
        folded={folded[project.id]}
        revealed={revealed[project.id] ?? 0}
        now={now}
        activeId={activeId}
        onFold={() => setFolded((old) => ({ ...old, [project.id]: !old[project.id] }))}
        onReveal={(next) => setRevealed((old) => ({ ...old, [project.id]: next }))}
        onSelect={props.onSelect}
        onMenu={setSessionMenu}
      />
    );
  };

  return (
    <>
      {pinnable && !docked && (
        <button
          type="button"
          aria-label="关闭会话列表"
          onClick={props.onClose}
          className={cn('fixed inset-0 z-40 bg-ink/35', !open && 'invisible pointer-events-none')}
        />
      )}
      <aside
        aria-label="会话列表"
        aria-hidden={!open}
        inert={!open}
        className={cn(
          'relative flex shrink-0 flex-col overflow-hidden bg-page',
          docked
            ? 'h-full w-[320px]'
            : cn(
                'fixed inset-y-0 left-0 z-50 w-full transition-transform duration-200',
                pinnable && 'max-w-[360px]',
                open ? 'translate-x-0' : 'invisible -translate-x-full'
              )
        )}
      >
        <header
          className={cn(
            'phone-list-header relative flex shrink-0 items-center gap-1 py-2 pr-3',
            docked ? 'pl-5' : 'pl-1'
          )}
        >
          {!docked && (
            <button
              type="button"
              aria-label="返回会话"
              onClick={props.onClose}
              className="flex size-12 shrink-0 items-center justify-center rounded-full text-ink active:bg-card2"
            >
              <ArrowLeft className="size-6" aria-hidden />
            </button>
          )}
          {docked && <img src="/icons/logo-192.png" alt="" className="mr-1.5 size-6 shrink-0" />}
          <h1 className="shrink-0 text-[22px] leading-7 font-bold tracking-[-0.01em]">CodeKiln</h1>
          <span className="ml-1 flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-card2/70 px-2">
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                props.connected ? 'bg-green' : 'bg-faint'
              )}
            />
            <span className="truncate text-[11px] leading-4 font-medium text-ink2">
              {props.connected ? `${device?.label ?? '电脑'} · 已连接` : props.connectionLabel}
            </span>
          </span>
          <div className="flex-1" />
          {pinnable && props.onTogglePinned && (
            <button
              type="button"
              onClick={props.onTogglePinned}
              aria-label={docked ? '收起侧栏' : '固定侧栏'}
              className="flex size-8 shrink-0 items-center justify-center text-dim"
            >
              {docked ? (
                <PanelLeftClose className="size-4" />
              ) : (
                <PanelLeftOpen className="size-4" />
              )}
            </button>
          )}
          <button
            type="button"
            aria-label="设备与通知"
            onClick={() => setSettingsOpen(true)}
            className="glass flex size-10 shrink-0 items-center justify-center rounded-full text-ink2"
          >
            <MonitorSmartphone className="size-5" />
          </button>
        </header>
        <div className="flex shrink-0 items-center justify-end gap-2.5 px-5 pt-1 pb-2">
          <span className="text-[13px] leading-4 text-dim tabular-nums">{waiting} 个等你</span>
          <button
            type="button"
            aria-label="按状态筛选"
            title={STATUS_FILTER_LABEL[filter]}
            aria-pressed={filter !== 'all'}
            onClick={() => setFilter(cycleStatusFilter(filter))}
            className={cn(
              'flex size-[38px] shrink-0 items-center justify-center rounded-full',
              filter === 'all' ? 'bg-card2 text-ink2' : 'bg-pill text-pill-ink'
            )}
          >
            <ArrowDownWideNarrow className="size-[18px]" />
          </button>
        </div>
        {groups.length > 0 && (
          <div className="shrink-0 px-5 pb-2">
            <Select
              items={[
                { value: ALL_GROUP_ID, label: '全部' },
                ...groups
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((group) => ({
                    value: group.id,
                    label: `${group.emoji ? `${group.emoji} ` : ''}${group.name}`,
                  })),
                { value: UNGROUPED_GROUP_ID, label: '未分组' },
              ]}
              value={groupId}
              onValueChange={(value) => {
                if (!value) return;
                setSelectedGroupId(value);
                try {
                  localStorage.setItem('enso-phone-selected-project-group', value);
                } catch {
                  /* optional persistence */
                }
              }}
            >
              <SelectTrigger className="h-9 w-full rounded-full border-0 bg-card2" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup zIndex={Z_INDEX.DROPDOWN_IN_MODAL}>
                <SelectItem value={ALL_GROUP_ID}>全部</SelectItem>
                {groups
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.emoji} {group.name}
                    </SelectItem>
                  ))}
                <SelectItem value={UNGROUPED_GROUP_ID}>未分组</SelectItem>
              </SelectPopup>
            </Select>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto pb-28">
          {filter !== 'all' && (
            <p className="px-5 py-1 text-[12px] leading-4 text-dim">
              {STATUS_FILTER_LABEL[filter]}
            </p>
          )}
          {projects.length === 0 && (
            <p className="px-5 py-8 text-center text-[13px] text-dim">桌面端还没有项目</p>
          )}
          {groupId === ALL_GROUP_ID && groups.length > 0
            ? sections.map((section) => (
                <div key={section.groupId}>
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedGroups((old) => ({
                        ...old,
                        [section.groupId]: !old[section.groupId],
                      }))
                    }
                    className="flex w-full items-center gap-1 px-5 pt-3 text-left text-[12px] font-medium text-dim"
                  >
                    <ChevronRight
                      className={cn('size-3.5', !collapsedGroups[section.groupId] && 'rotate-90')}
                    />
                    {section.group?.emoji} {section.group?.name ?? '未分组'}
                  </button>
                  {!collapsedGroups[section.groupId] && section.projects.map(renderProject)}
                </div>
              ))
            : availableProjects.map(renderProject)}
          {orphans.length > 0 && (
            <ProjectList
              name="其他"
              sessions={orphans}
              folded={folded.orphans}
              revealed={revealed.orphans ?? 0}
              activeId={activeId}
              now={now}
              onFold={() => setFolded((old) => ({ ...old, orphans: !old.orphans }))}
              onReveal={(next) => setRevealed((old) => ({ ...old, orphans: next }))}
              onSelect={props.onSelect}
              onMenu={setSessionMenu}
            />
          )}
          {archives.length > 0 && (
            <div className="pt-4">
              <button
                type="button"
                onClick={() => setArchivedOpen(!archivedOpen)}
                className="flex w-full items-center gap-2 px-5 py-2 text-[13px] text-dim"
              >
                <Archive className="size-4" />
                <span className="flex-1 text-left">已归档</span>
                {archives.length}
                <ChevronRight className={cn('size-3.5', archivedOpen && 'rotate-90')} />
              </button>
              {archivedOpen &&
                archives.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    active={activeId === session.id}
                    now={now}
                    onSelect={props.onSelect}
                    onMenu={setSessionMenu}
                  />
                ))}
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-page via-page/85 to-transparent" />
        <div className="phone-list-actions absolute right-4 flex items-center gap-3">
          {activeId && (
            <FileDownloads
              target={{ sessionId: activeId }}
              triggerClassName="glass flex size-14 shrink-0 items-center justify-center rounded-full text-ink"
            >
              <Download className="size-6" />
            </FileDownloads>
          )}
          <button
            type="button"
            aria-label="新会话"
            disabled={!canCreate || !newProject}
            onClick={() => newProject && props.onNewConversation(newProject.id)}
            className="glass-ink flex size-14 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
          >
            <SquarePen className="size-6" />
          </button>
        </div>
        {menuEntry && (
          <>
            <button
              type="button"
              aria-label="关闭会话操作"
              onClick={() => setSessionMenu(null)}
              className="absolute inset-0 z-20 bg-ink/35"
            />
            <section
              role="dialog"
              aria-label="会话操作"
              className="absolute inset-x-0 bottom-0 z-30 rounded-t-[28px] bg-page px-5 pt-5 pb-8"
            >
              <h2 className="truncate text-[17px] font-semibold">{menuEntry.title || '新会话'}</h2>
              <button
                type="button"
                onClick={() => {
                  setSessionMenu(null);
                  props.onSelect(menuEntry.id);
                }}
                className="mt-4 h-12 w-full rounded-full bg-pill text-[15px] text-pill-ink"
              >
                打开会话
              </button>
              {canCreate && (
                <button
                  type="button"
                  onClick={() => {
                    setSessionMenu(null);
                    props.onNewConversation(menuEntry.projectId);
                  }}
                  className="mt-2 h-12 w-full rounded-full bg-card text-[15px]"
                >
                  在此项目新建会话
                </button>
              )}
              <button
                type="button"
                onClick={() => setSessionMenu(null)}
                className="mt-2 h-12 w-full rounded-full bg-card2 text-[15px]"
              >
                取消
              </button>
            </section>
          </>
        )}
        <PhoneSettingsScreen
          {...props}
          open={open && settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      </aside>
    </>
  );
}

function SessionRow({
  session,
  active,
  now,
  onSelect,
  onMenu,
}: {
  session: CatalogEntry;
  active: boolean;
  now: number;
  onSelect(id: string): void;
  onMenu(id: string): void;
}) {
  const tone = rowTone(session);
  const note =
    tone === 'waiting'
      ? '需要你处理'
      : tone === 'running'
        ? '正在运行'
        : tone === 'error'
          ? '上一步失败'
          : session.unread
            ? '已交付'
            : '空闲';
  return (
    <div
      className={cn(
        'flex items-center',
        tone === 'waiting' ? waitingRowClass : active ? 'bg-card2/40' : ''
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(session.id)}
        className="flex min-w-0 flex-1 items-start gap-2 py-2.5 pl-5 text-left"
      >
        {session.pinned && (
          <span className="flex h-[22px] shrink-0 items-center">
            <Pin className="size-3.5 text-yellow" aria-label="已置顶" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className={rowTitleClass(tone)}>{session.title || '新对话'}</span>
          <span className="flex items-center gap-1.5 text-[13px] leading-[18px] text-dim">
            <span className="truncate">{note}</span>
            {session.updatedAt ? (
              <>
                <span className="text-faint">·</span>
                <span className="shrink-0 tabular-nums">
                  {formatRelativeTime(session.updatedAt, 'zh', now)}
                </span>
              </>
            ) : null}
          </span>
        </span>
        <span className="flex h-[22px] shrink-0 items-center">
          <StatusGlyph tone={tone} size={15} />
        </span>
      </button>
      <button
        type="button"
        aria-label={`${session.title || '新对话'} 的更多操作`}
        onClick={() => onMenu(session.id)}
        className="mr-1 flex size-12 shrink-0 items-center justify-center text-faint"
      >
        <EllipsisVertical className="size-5" />
      </button>
    </div>
  );
}

function ProjectList({
  name,
  badge,
  sessions,
  folded,
  revealed,
  activeId,
  now,
  onFold,
  onReveal,
  onSelect,
  onMenu,
}: {
  name: string;
  badge?: string;
  sessions: CatalogEntry[];
  folded?: boolean;
  revealed: number;
  activeId: string | null;
  now: number;
  onFold(): void;
  onReveal(next: number): void;
  onSelect(id: string): void;
  onMenu(id: string): void;
}) {
  const shown = shownConversationCount(sessions.length, revealed);
  const hidden = sessions.length - shown;
  return (
    <div>
      <button
        type="button"
        onClick={onFold}
        aria-expanded={!folded}
        className="flex w-full items-center gap-2 px-5 pt-3 pb-1 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium text-dim">
          {name}
          {badge && <span className="ml-1.5 text-[11px]">{badge}</span>}
        </span>
        <span className="shrink-0 text-[11px] leading-4 text-faint tabular-nums">
          {sessions.length} 个会话
        </span>
      </button>
      {!folded && (
        <>
          {sessions.slice(0, shown).map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              active={activeId === session.id}
              now={now}
              onSelect={onSelect}
              onMenu={onMenu}
            />
          ))}
          {sessions.length > COLLAPSED_SESSION_LIMIT && (
            <div className="flex gap-2 px-5">
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => onReveal(nextRevealedExtra(sessions.length, revealed))}
                  className="flex-1 py-2 text-[11px] text-dim"
                >
                  显示更多（{hidden}）
                </button>
              )}
              {revealed > 0 && (
                <button
                  type="button"
                  onClick={() => onReveal(prevRevealedExtra(revealed))}
                  className="flex-1 py-2 text-[11px] text-dim"
                >
                  收起
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
