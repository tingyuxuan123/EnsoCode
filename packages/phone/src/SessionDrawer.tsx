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
  Bell,
  ChevronRight,
  Laptop,
  MessageSquarePlus,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  Plus,
  Unplug,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/i18n';
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
import type { PushFailureReason } from './push';
import { rowTitleClass, rowTone, StatusGlyph, waitingRowClass } from './StatusGlyph';
import {
  getThemePreference,
  setThemePreference,
  subscribeTheme,
  type ThemePreference,
} from './theme';

/**
 * 手机侧边栏：复刻桌面 Sidebar 的项目分组结构（chevron / 仓库图标 / 状态点 /
 * 相对时间 / 折叠更多），改为抽屉式呈现。桌面版的加项目、导入、删除属于
 * 宿主能力，手机端不提供。
 */

/** auto = 跟随桌面下发；其余为本地覆盖 */
const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'auto', label: '跟随桌面' },
  { value: 'light', label: '浅' },
  { value: 'dark', label: '深' },
];

const PUSH_ERROR_TEXT: Record<PushFailureReason, string> = {
  unsupported: '当前浏览器不支持推送。',
  'permission-denied': '通知权限被拒绝，请在浏览器站点设置中允许后重试。',
  'service-unreachable': '无法连接 Google 推送服务（FCM），请检查网络或代理后重试。',
  'subscribe-failed': '订阅失败，请稍后重试。',
};

interface Props {
  open: boolean;
  /** 大屏横屏：左栏常驻布局，不渲染遮罩、无关闭按钮，onClose 由调用方保持空操作 */
  docked?: boolean;
  /** 当前窗口满足常驻条件：显示 常驻/折叠 切换入口 */
  pinnable?: boolean;
  /** 切换 常驻/折叠；调用方负责持久化 */
  onTogglePinned?(): void;
  projects: ProjectEntry[];
  groups?: ProjectGroupEntry[];
  catalog: CatalogEntry[];
  /** 桌面置顶组的手动拖拽顺序；缺省（旧桌面）按活跃倒序 */
  activeId: string | null;
  canCreate: boolean;
  /** 已配对的桌面列表（切换式：一次只连活跃那台） */
  devices: StoredDevice[];
  activeDevicePairId: string | null;
  /** 活跃那台的连接状态 */
  connected: boolean;
  connectionLabel: string;
  pushEnabled: boolean;
  /** 订阅进行中（权限弹框 + FCM 注册）：开关保持乐观已开但禁用 */
  pushBusy: boolean;
  /** 上次开启失败的原因；据此给出可自救的提示 */
  pushError: PushFailureReason | null;
  pushAvailability: 'ok' | 'needs-install' | 'unsupported';
  /** 已收到桌面的 push-config；旧版桌面不会发，此时开关禁用并提示升级 */
  pushConfigReady: boolean;
  onTogglePush(next: boolean): void;
  onClose(): void;
  onSelect(sessionId: string): void;
  onNewConversation(projectId: string): void;
  onSwitchDevice(pairId: string): void;
  onAddDevice(): void;
  onRenameDevice(pairId: string, label: string): void;
  /** 解绑指定那台；删到没有时回配对页 */
  onUnpairDevice(pairId: string): void;
  /** 桌面开启 Bot 模式后才有：顶部切换「项目 | Bot」 */
  botSegment?: { active: boolean; onChange(active: boolean): void; panel: ReactNode };
}

export function SessionDrawer({
  open,
  docked = false,
  pinnable = false,
  onTogglePinned,
  projects,
  groups = [],
  catalog,
  activeId,
  canCreate,
  devices,
  activeDevicePairId,
  connected,
  connectionLabel,
  pushEnabled,
  pushBusy,
  pushError,
  pushAvailability,
  pushConfigReady,
  onTogglePush,
  onClose,
  onSelect,
  onNewConversation,
  onSwitchDevice,
  onAddDevice,
  onRenameDevice,
  onUnpairDevice,
  botSegment,
}: Props) {
  const botActive = botSegment?.active === true;
  const [foldedProjects, setFoldedProjects] = useState<Record<string, boolean>>({});
  const [revealedExtras, setRevealedExtras] = useState<Record<string, number>>({});
  // 底部「已归档」栏目的折叠态（与桌面一致：缺省收起）
  const [archivedOpen, setArchivedOpen] = useState(false);
  /** 待确认解绑的 pairId；null = 无确认框 */
  const [confirmUnpair, setConfirmUnpair] = useState<string | null>(null);
  const [themePref, setThemePref] = useState<ThemePreference>(getThemePreference);
  const [selectedGroupId, setSelectedGroupId] = useState(() => {
    try {
      return localStorage.getItem('enso-phone-selected-project-group') ?? ALL_GROUP_ID;
    } catch {
      return ALL_GROUP_ID;
    }
  });
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Record<string, boolean>>({});
  const resolvedGroupId =
    selectedGroupId === ALL_GROUP_ID ||
    selectedGroupId === UNGROUPED_GROUP_ID ||
    groups.some((group) => group.id === selectedGroupId)
      ? selectedGroupId
      : ALL_GROUP_ID;

  // 主题可能由桌面下发触发变化，订阅后同步按钮高亮
  useEffect(() => subscribeTheme(() => setThemePref(getThemePreference())), []);

  // 抽屉关闭时收起确认态，避免下次打开还停在确认框
  useEffect(() => {
    if (!open) setConfirmUnpair(null);
  }, [open]);

  // 相对时间每分钟自刷。抽屉关闭时停表；再打开必须先刷 now，否则会拿着冻结基准
  // 把更新过的会话算成未来（「x 小时后」）。杀进程重挂看起来像「同步好了」。
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    setNowTick(Date.now());
    const timer = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [open]);

  // 与桌面侧栏同语义：归档不进项目组，只进底部栏目；置顶另起一栏且组内靠前；
  // 归档项目整组视为归档（会话自身标记不动，桌面恢复项目后原样回来）
  const archivedProjects = new Set(projects.filter((p) => p.archived).map((p) => p.id));
  const archivedProjectIds = [...archivedProjects];
  const isArchived = (c: CatalogEntry) => c.archived || archivedProjects.has(c.projectId);
  const activeProjects = filterProjectsByGroup(
    projects,
    groups,
    archivedProjectIds,
    resolvedGroupId
  );
  const groupSections = sectionsForAllView(projects, groups, archivedProjectIds);
  const topLevel = catalog.filter((c) => !c.parentId);
  const archivedSessions = sortByActivity(
    topLevel.filter((c) => {
      if (!isArchived(c)) return false;
      if (resolvedGroupId === ALL_GROUP_ID) return true;
      const project = projects.find((item) => item.id === c.projectId);
      if (!project) return resolvedGroupId === UNGROUPED_GROUP_ID;
      if (resolvedGroupId === UNGROUPED_GROUP_ID) {
        return !project.groupId || !groups.some((item) => item.id === project.groupId);
      }
      return project.groupId === resolvedGroupId;
    })
  );
  const active = topLevel.filter((c) => !isArchived(c));

  // 没有项目归属的会话（项目已删等）单独归到「其他」
  const known = new Set(projects.map((p) => p.id));
  const orphans = orderProjectSessions(active.filter((c) => !known.has(c.projectId)));

  return (
    <>
      {!docked && (
        <button
          type="button"
          aria-label="关闭侧栏"
          onClick={onClose}
          // 关闭后要 visibility:hidden 而非只透明：iOS standalone 的状态栏底色采样页面顶边，
          // 仅改 opacity 不触发重采，会把遮罩色（黑 40% 叠白 = #999）卡在状态栏直到重开
          className={cn(
            'fixed inset-0 z-40 bg-black/40 transition-[opacity,visibility] duration-200',
            open ? 'visible opacity-100' : 'invisible pointer-events-none opacity-0'
          )}
        />
      )}
      <aside
        className={cn(
          'flex shrink-0 flex-col bg-page',
          docked
            ? 'relative h-full w-72'
            : cn(
                'fixed inset-y-0 left-0 z-50 w-[82vw] max-w-xs transition-transform duration-200',
                open ? 'translate-x-0' : '-translate-x-full'
              )
        )}
      >
        {/* 设计稿 sessions.tsx：品牌字标 + 连接状态在头一行，不带边框 */}
        <div className="flex min-h-[48px] shrink-0 items-center gap-2 px-5 pt-safe pb-1">
          <img src="/icons/logo-192.png" alt="" className="size-6 shrink-0 rounded-[6px]" />
          <h1 className="text-[22px] leading-7 font-bold tracking-[-0.01em]">Collabra</h1>
          <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-card2 px-2">
            <span
              className={cn('size-1.5 shrink-0 rounded-full', connected ? 'bg-green' : 'bg-faint')}
            />
            <span className="truncate text-[11px] leading-4 font-medium text-ink2">
              {connected ? '已连接' : connectionLabel}
            </span>
          </span>
          <div className="flex-1" />
          {docked ? (
            pinnable && onTogglePinned ? (
              <button
                type="button"
                onClick={onTogglePinned}
                aria-label="收起侧栏"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            ) : null
          ) : (
            <span className="flex items-center">
              {pinnable && onTogglePinned && (
                <button
                  type="button"
                  onClick={onTogglePinned}
                  aria-label="固定侧栏"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭侧栏"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </span>
          )}
        </div>
        {/* 分段：项目 / Bot，胶囊样式（设计稿 sessions.tsx 的「编程 / Bot」） */}
        {botSegment && (
          <div className="shrink-0 px-5 pb-2">
            <div className="flex w-fit rounded-full bg-card2 p-1">
              {(['项目', 'Bot'] as const).map((label) => {
                const selected = (label === 'Bot') === botSegment.active;
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => botSegment.onChange(label === 'Bot')}
                    className={cn(
                      'flex h-8 items-center rounded-full px-3.5 text-[14px] leading-5 transition-colors',
                      selected
                        ? 'bg-card font-medium text-ink shadow-[0_1px_3px_rgb(0_0_0/0.08)]'
                        : 'font-medium text-dim'
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {!botActive && groups.length > 0 && (
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
              value={resolvedGroupId}
              onValueChange={(value) => {
                if (!value) return;
                setSelectedGroupId(value);
                try {
                  localStorage.setItem('enso-phone-selected-project-group', value);
                } catch {
                  /* ignore */
                }
              }}
            >
              <SelectTrigger className="w-full" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup zIndex={Z_INDEX.DROPDOWN_IN_MODAL}>
                <SelectItem value={ALL_GROUP_ID}>全部</SelectItem>
                {groups
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.emoji ? `${group.emoji} ` : ''}
                      {group.name}
                    </SelectItem>
                  ))}
                <SelectItem value={UNGROUPED_GROUP_ID}>未分组</SelectItem>
              </SelectPopup>
            </Select>
          </div>
        )}

        {botActive ? (
          botSegment?.panel
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {projects.length === 0 && (
              <p className="px-3 py-8 text-center text-[13px] leading-5 text-dim">
                桌面端还没有项目
              </p>
            )}

            {(resolvedGroupId === ALL_GROUP_ID && groups.length > 0
              ? groupSections.flatMap((section) => {
                  const folded = collapsedGroupIds[section.groupId] === true;
                  return [
                    { kind: 'header' as const, section, folded },
                    ...(folded
                      ? []
                      : section.projects.map((project) => ({ kind: 'project' as const, project }))),
                  ];
                })
              : activeProjects.map((project) => ({ kind: 'project' as const, project }))
            ).map((item) =>
              item.kind === 'header' ? (
                <button
                  key={`hdr-${item.section.groupId}`}
                  type="button"
                  onClick={() =>
                    setCollapsedGroupIds((prev) => ({
                      ...prev,
                      [item.section.groupId]: !prev[item.section.groupId],
                    }))
                  }
                  className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-xs font-medium text-muted-foreground"
                >
                  <ChevronRight
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 transition-transform duration-150',
                      !item.folded && 'rotate-90'
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
                    {item.section.group?.name ?? '未分组'}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/70">
                    {item.section.projects.length}
                  </span>
                </button>
              ) : (
                <ProjectGroup
                  key={item.project.id}
                  name={pairProjectDisplayName(item.project)}
                  badge={sshProjectLabel(item.project)}
                  sessions={orderProjectSessions(
                    active.filter((c) => c.projectId === item.project.id)
                  )}
                  folded={foldedProjects[item.project.id] === true}
                  revealedExtra={revealedExtras[item.project.id] ?? 0}
                  activeId={activeId}
                  nowTick={nowTick}
                  canCreate={canCreate}
                  onToggleFold={() =>
                    setFoldedProjects((prev) => ({
                      ...prev,
                      [item.project.id]: !prev[item.project.id],
                    }))
                  }
                  onRevealMore={(next) =>
                    setRevealedExtras((prev) => ({ ...prev, [item.project.id]: next }))
                  }
                  onSelect={onSelect}
                  onNew={() => onNewConversation(item.project.id)}
                />
              )
            )}

            {orphans.length > 0 && (
              <ProjectGroup
                name="其他"
                sessions={orphans}
                folded={foldedProjects.__orphan === true}
                revealedExtra={revealedExtras.__orphan ?? 0}
                activeId={activeId}
                nowTick={nowTick}
                canCreate={false}
                onToggleFold={() =>
                  setFoldedProjects((prev) => ({ ...prev, __orphan: !prev.__orphan }))
                }
                onRevealMore={(next) => setRevealedExtras((prev) => ({ ...prev, __orphan: next }))}
                onSelect={onSelect}
              />
            )}
          </div>
        )}

        {/* 与桌面一致：归档栏固定底部（滚动区外），列表在折叠头上方向上展开 */}
        {!botActive && archivedSessions.length > 0 && (
          <div className="shrink-0 px-3 pb-1">
            {archivedOpen && (
              <div className="mb-0.5 flex max-h-64 flex-col gap-y-0.5 overflow-y-auto">
                {archivedSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    active={activeId === session.id}
                    nowTick={nowTick}
                    subtitle={(() => {
                      const project = projects.find((p) => p.id === session.projectId);
                      return project ? pairProjectDisplayName(project) : undefined;
                    })()}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setArchivedOpen((prev) => !prev)}
              className="flex w-full items-center gap-1 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/60"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                <ChevronRight
                  className={cn(
                    'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200',
                    archivedOpen ? '-rotate-90' : 'rotate-0'
                  )}
                />
              </span>
              <Archive className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-dim">
                已归档
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                {archivedSessions.length}
              </span>
            </button>
          </div>
        )}

        <div className="shrink-0 space-y-1 px-3 pb-safe pt-2">
          {!confirmUnpair && (
            <div className="flex items-center gap-2 px-2 py-1.5">
              <Palette className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-[15px] leading-5 text-ink2">主题</span>
              <div className="flex shrink-0 gap-0.5 rounded-full bg-card2 p-0.5">
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setThemePreference(option.value)}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11px] leading-4 transition-colors',
                      themePref === option.value
                        ? 'bg-card font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]'
                        : 'text-dim'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!confirmUnpair && (
            <div className="px-2 py-1.5">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 text-[15px] leading-5 text-ink2">推送通知</span>
                <Switch
                  checked={pushEnabled}
                  disabled={pushBusy || pushAvailability !== 'ok' || !connected || !pushConfigReady}
                  onCheckedChange={onTogglePush}
                />
              </div>
              {pushBusy && <p className="mt-1 pl-6 text-[11px] text-muted-foreground">正在开启…</p>}
              {pushError && !pushBusy && (
                <p className="mt-1 pl-6 text-[11px] text-destructive">
                  {PUSH_ERROR_TEXT[pushError]}
                </p>
              )}
              {pushAvailability === 'ok' && connected && !pushConfigReady && (
                <p className="mt-1 pl-6 text-[11px] text-muted-foreground">
                  需先升级桌面端 Collabra 才能开启推送。
                </p>
              )}
              {pushAvailability === 'needs-install' && (
                <p className="mt-1 pl-6 text-[11px] text-muted-foreground">
                  iOS 需先用分享菜单「添加到主屏幕」，从主屏幕打开后才能开启。
                </p>
              )}
              {pushAvailability === 'unsupported' && (
                <p className="mt-1 pl-6 text-[11px] text-muted-foreground">
                  当前浏览器不支持推送。
                </p>
              )}
            </div>
          )}

          <div className="space-y-0.5">
            {devices.map((d) => {
              const isActive = d.pairId === activeDevicePairId;
              if (confirmUnpair === d.pairId) {
                return (
                  <div key={d.pairId} className="space-y-2 rounded-md border border-dashed p-3">
                    <p className="text-xs">解绑「{d.label}」后需重新扫码才能连接，确定吗？</p>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setConfirmUnpair(null)}>
                        取消
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          setConfirmUnpair(null);
                          onUnpairDevice(d.pairId);
                        }}
                      >
                        确定解绑
                      </Button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={d.pairId} className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => onSwitchDevice(d.pairId)}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 rounded-[14px] px-2 py-2 text-left text-[15px] leading-5 transition-colors active:bg-card2',
                      isActive ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    <Laptop className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{d.label}</span>
                    {isActive && (
                      <span
                        className={cn(
                          'shrink-0 text-[10px]',
                          connected ? 'text-muted-foreground' : 'text-destructive'
                        )}
                      >
                        {connectionLabel}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={`重命名 ${d.label}`}
                    onClick={() => {
                      const label = window.prompt('给这台电脑起个名：', d.label);
                      if (label?.trim()) onRenameDevice(d.pairId, label);
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`解绑 ${d.label}`}
                    onClick={() => setConfirmUnpair(d.pairId)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-destructive"
                  >
                    <Unplug className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={onAddDevice}
              className="flex w-full items-center gap-2 rounded-[14px] px-2 py-2 text-left text-[15px] leading-5 text-ink2 transition-colors active:bg-card2"
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span>配对新电脑</span>
            </button>
          </div>

          <p className="px-2 pt-0.5 text-center text-[11px] leading-4 text-faint">
            版本 {__COMMIT__}
          </p>
        </div>
      </aside>
    </>
  );
}

/**
 * 置顶/归档/项目组共用的会话行：无框列表，16px 标题 + 13px 副行 + 右侧状态符号。
 * 等你处理的那条整行黄底，完成与空闲不画符号（设计稿 `sessions.tsx`）。
 */
function SessionRow({
  session,
  active,
  nowTick,
  subtitle,
  onSelect,
}: {
  session: CatalogEntry;
  active: boolean;
  nowTick: number;
  subtitle?: string;
  onSelect(id: string): void;
}) {
  const tone = rowTone(session);
  const note = subtitle ?? session.projectName;
  return (
    <button
      type="button"
      onClick={() => onSelect(session.id)}
      className={cn(
        'flex min-h-[46px] w-full items-start gap-2 py-2.5 pr-2 pl-5 text-left transition-colors',
        tone === 'waiting' ? waitingRowClass : active ? 'bg-card2' : 'active:bg-card2'
      )}
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
                {formatRelativeTime(session.updatedAt, 'zh', nowTick)}
              </span>
            </>
          ) : null}
        </span>
      </span>
      <span className="flex h-[22px] shrink-0 items-center">
        <StatusGlyph tone={tone} />
      </span>
    </button>
  );
}

function ProjectGroup({
  name,
  badge,
  sessions,
  folded,
  revealedExtra,
  activeId,
  nowTick,
  canCreate,
  onToggleFold,
  onRevealMore,
  onSelect,
  onNew,
}: {
  name: string;
  badge?: string;
  sessions: CatalogEntry[];
  folded: boolean;
  revealedExtra: number;
  activeId: string | null;
  nowTick: number;
  canCreate: boolean;
  onToggleFold(): void;
  onRevealMore(next: number): void;
  onSelect(id: string): void;
  onNew?(): void;
}) {
  const { t } = useI18n();
  const shownCount = shownConversationCount(sessions.length, revealedExtra);
  const shown = sessions.slice(0, shownCount);
  const hidden = sessions.length - shownCount;
  return (
    <div>
      <div className="flex w-full items-center gap-1 px-5 pt-3 pb-1 transition-colors">
        <button
          type="button"
          onClick={onToggleFold}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 text-faint transition-transform duration-200',
                !folded && 'rotate-90'
              )}
            />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium text-dim">
            {name}
            {badge && (
              <span className="ml-1.5 rounded-full bg-card2 px-1.5 py-0.5 text-[11px] leading-4 font-normal text-dim">
                {badge}
              </span>
            )}
          </span>
          <span className="shrink-0 text-[11px] leading-4 text-faint tabular-nums">
            {sessions.length} 个会话
          </span>
        </button>
        {canCreate && onNew && (
          <button
            type="button"
            onClick={onNew}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {!folded && (
        <div className="mt-0.5 flex flex-col gap-y-0.5">
          {shown.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              active={activeId === session.id}
              nowTick={nowTick}
              onSelect={onSelect}
            />
          ))}
          {sessions.length > COLLAPSED_SESSION_LIMIT && (
            <div className="flex items-center gap-1">
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => onRevealMore(nextRevealedExtra(sessions.length, revealedExtra))}
                  className="flex-1 py-1.5 text-center text-[11px] leading-4 text-dim transition-colors active:text-ink"
                >
                  {t('Show {{n}} more', { n: hidden })}
                </button>
              )}
              {revealedExtra > 0 && (
                <button
                  type="button"
                  onClick={() => onRevealMore(prevRevealedExtra(revealedExtra))}
                  className="flex-1 py-1.5 text-center text-[11px] leading-4 text-dim transition-colors active:text-ink"
                >
                  {t('Collapse')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
