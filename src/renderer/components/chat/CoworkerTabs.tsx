import {
  agentInstanceDisplayName,
  effectiveDisabledBuiltinAgentTypes,
} from '@shared/builtinAgents';
import { coworkerTabTone } from '@shared/conversationDotTone';
import { BUILTIN_AGENT_TYPES } from '@shared/types/assets';
import { Bot, Ellipsis, MessageCircle, Pencil, Plus, RefreshCw, RotateCcw, X } from 'lucide-react';
import * as React from 'react';
import { ConversationStatusIndicator } from '@/components/chat/ConversationStatusIndicator';
import { ConversationTitleEdit } from '@/components/chat/ConversationTitleEdit';
import { reloadConversationFromMenu } from '@/components/chat/reloadConversationAction';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/i18n';
import { addSidePanelSubagent } from '@/lib/sidePanelDock';
import { cn } from '@/lib/utils';
import { Z_INDEX } from '@/lib/z-index';
import { useSessionsStore } from '@/stores/sessions';
import { selectCoworkerTabConversations } from '@/stores/sessions/sidebarDirectory';
import { useSettingsStore } from '@/stores/settings';
import { ConfirmDialog } from './ConfirmDialog';

/** deltaMode=1 表示按行上报；取实际行高，取不到时用 16px 的常规行高。 */
function wheelLineHeightPx(el: HTMLElement): number {
  const parsed = Number.parseFloat(getComputedStyle(el).lineHeight);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 16;
}

/**
 * 顶部只放可交互的持久协作者；X 关闭视图，解雇必须走操作菜单的二次确认。
 */
export function CoworkerTabs({
  parentId,
  displayedId,
  trailing,
}: {
  parentId: string;
  displayedId: string;
  trailing?: React.ReactNode;
}) {
  const { t } = useI18n();
  const parentTitle = useSessionsStore((state) => state.conversations[parentId]?.title ?? '');
  const parentStarted = useSessionsStore(
    (state) => state.conversations[parentId]?.started === true
  );
  const parentReloading = useSessionsStore(
    (state) => state.conversations[parentId]?.reloading === true
  );
  const parentSpawning = useSessionsStore((state) =>
    Boolean(state.conversations[parentId]?.spawning)
  );
  const coworkers = useSessionsStore((state) =>
    selectCoworkerTabConversations(state.conversations, parentId)
  );
  const allCoworkers = useSessionsStore((state) =>
    selectCoworkerTabConversations(state.conversations, parentId, true)
  );
  const visibleIds = new Set(coworkers.map((item) => item.id));
  const hiddenCoworkers = allCoworkers.filter((item) => !visibleIds.has(item.id));
  const [hiring, setHiring] = React.useState(false);
  const [dismissId, setDismissId] = React.useState<string | null>(null);
  const dismissTarget = allCoworkers.find((item) => item.id === dismissId);
  const displayedTask = useSessionsStore(
    (state) => state.conversations[displayedId]?.child?.mode === 'task'
  );
  React.useEffect(() => {
    // 热更新或旧通知可能仍选中 task；只回到父视图，不停止实体。
    if (displayedId !== parentId && displayedTask) {
      useSessionsStore.getState().selectTab(parentId, undefined);
    }
  }, [displayedTask, displayedId, parentId]);

  // 页签条横向溢出时，普通鼠标纵向滚轮也转成横向滚动，否则右侧页签被裁掉又发现不了。
  // React 的 onWheel 走 passive 监听无法 preventDefault，这里挂原生非 passive 监听；
  // 触控板横滑（deltaX）、Shift+滚轮和 Ctrl+滚轮缩放都保持原生，不重复映射。
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.shiftKey) return;
      const { deltaX, deltaY, deltaMode } = event;
      // 只接管以纵向为主的滚轮；横向手势交给浏览器。
      if (deltaY === 0 || Math.abs(deltaX) >= Math.abs(deltaY)) return;
      const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
      if (maxScrollLeft <= 0) return;
      const unit =
        deltaMode === 1 ? wheelLineHeightPx(scroller) : deltaMode === 2 ? scroller.clientWidth : 1;
      const next = Math.min(Math.max(scroller.scrollLeft + deltaY * unit, 0), maxScrollLeft);
      // 已到该方向的边界就放行，继续滚页面，不吞事件。
      if (next === scroller.scrollLeft) return;
      event.preventDefault();
      scroller.scrollLeft = next;
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, []);

  // 与上游一致的浅色胶囊页签：选中项用中性 secondary 底 + 前景色文字，未选中只在悬停出更淡的底。
  // 不用 muted：cloud-light 的 muted 与 background 几乎同色，胶囊会整体消失。
  const tabClass = (active: boolean) =>
    cn(
      'relative flex min-w-0 shrink-0 items-center gap-[calc(6rem/14)] rounded-[calc(6rem/14)] px-[calc(8rem/14)] py-[calc(4rem/14)] text-[calc(12rem/14)] transition-colors',
      active
        ? 'bg-secondary font-medium text-foreground'
        : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
    );

  return (
    <div
      data-slot="conversation-tabs"
      className="flex shrink-0 items-center gap-[calc(4rem/14)] border-b border-line px-3 py-[calc(4rem/14)]"
    >
      <div
        data-slot="conversation-tab-scroller"
        ref={scrollerRef}
        className="flex min-w-0 flex-1 items-center gap-[calc(4rem/14)] overflow-x-auto [scrollbar-width:none]"
      >
        <div
          role="tablist"
          aria-label={t('Conversations')}
          className="flex shrink-0 items-center gap-[calc(4rem/14)]"
        >
          <RenameableTab
            id={parentId}
            active={displayedId === parentId}
            // 会话标题只在页签里出现（标题栏只留品牌），双击仍可重命名
            label={parentTitle || t('New conversation')}
            className={tabClass(displayedId === parentId)}
            leading={<MessageCircle className="size-[calc(12rem/14)] shrink-0" />}
            reloadDisabled={parentReloading || parentSpawning}
            reloading={parentReloading}
            onSelect={() => useSessionsStore.getState().selectTab(parentId, undefined)}
          />
          {coworkers.map((coworker) => {
            const tone = coworkerTabTone({
              status: coworker.status,
              spawning: coworker.spawning,
              pendingApprovalCount: coworker.pendingApprovalCount,
              pendingAskCount: coworker.pendingAskCount,
              pendingCapabilityAskCount: coworker.pendingCapabilityAskCount,
            });
            return (
              <div key={coworker.id} className="group/tab relative shrink-0">
                <RenameableTab
                  id={coworker.id}
                  active={displayedId === coworker.id}
                  label={agentInstanceDisplayName(
                    !coworker.title || coworker.title === coworker.child?.agentInstanceName
                      ? coworker.child?.agentTypeKey
                      : undefined,
                    coworker.title ||
                      coworker.child?.agentInstanceName ||
                      coworker.coworkerName ||
                      coworker.id
                  )}
                  className={cn(
                    tabClass(displayedId === coworker.id),
                    displayedId !== coworker.id && 'group-hover/tab:text-foreground'
                  )}
                  leading={<Bot className="size-[calc(12rem/14)] shrink-0" />}
                  trailing={
                    // 预留操作位：状态点与悬停操作（⋯ / ×）共用同一条右缘槽位，
                    // 悬停时只换内容不拉宽页签，也不会压住标题文字。
                    <span
                      data-slot="tab-action-lane"
                      className="flex h-3 w-[calc(35rem/14)] shrink-0 items-center justify-end"
                    >
                      <span className="inline-flex items-center justify-center group-hover/tab:invisible group-focus-within/tab:invisible">
                        <ConversationStatusIndicator tone={tone} size="sm" />
                      </span>
                    </span>
                  }
                  reloadDisabled={coworker.reloading || coworker.spawning}
                  reloading={coworker.reloading}
                  onSelect={() => useSessionsStore.getState().selectTab(parentId, coworker.id)}
                  onViewProcess={
                    coworker.canObserve
                      ? () =>
                          addSidePanelSubagent({
                            parentConversationId: parentId,
                            childConversationId: coworker.id,
                          })
                      : undefined
                  }
                  onCloseConversation={() =>
                    useSessionsStore.getState().closeCoworkerTab(parentId, coworker.id)
                  }
                  onDismiss={() => setDismissId(coworker.id)}
                />
                <div
                  data-slot="tab-actions"
                  className="absolute top-1/2 right-[calc(2rem/14)] flex -translate-y-1/2 items-center gap-[calc(1rem/14)] opacity-0 transition-opacity focus-within:opacity-100 group-hover/tab:opacity-100"
                >
                  <Menu>
                    <MenuTrigger
                      aria-label={t('Collaborator actions')}
                      title={t('Collaborator actions')}
                      className="flex size-[calc(16rem/14)] items-center justify-center rounded-[calc(4rem/14)] text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Ellipsis className="size-[calc(12rem/14)]" />
                    </MenuTrigger>
                    <MenuPopup align="end">
                      {coworker.canObserve && (
                        <MenuItem
                          onClick={() =>
                            addSidePanelSubagent({
                              parentConversationId: parentId,
                              childConversationId: coworker.id,
                            })
                          }
                        >
                          {t('View process')}
                        </MenuItem>
                      )}
                      <MenuItem
                        onClick={() =>
                          useSessionsStore.getState().closeCoworkerTab(parentId, coworker.id)
                        }
                      >
                        {t('Close conversation view')}
                      </MenuItem>
                      <MenuItem variant="destructive" onClick={() => setDismissId(coworker.id)}>
                        {t('Dismiss collaborator')}
                      </MenuItem>
                    </MenuPopup>
                  </Menu>
                  <button
                    type="button"
                    title={t('Close conversation view')}
                    aria-label={t('Close conversation view')}
                    data-coworker-close={coworker.id}
                    className="flex size-[calc(16rem/14)] items-center justify-center rounded-[calc(4rem/14)] text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() =>
                      useSessionsStore.getState().closeCoworkerTab(parentId, coworker.id)
                    }
                  >
                    <X className="size-[calc(12rem/14)]" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {hiddenCoworkers.length > 0 && (
          <Menu>
            <MenuTrigger
              aria-label={t('Reopen collaborator')}
              title={t('Reopen collaborator')}
              className="flex shrink-0 items-center gap-[calc(4rem/14)] rounded-[calc(6rem/14)] px-[calc(6rem/14)] py-[calc(4rem/14)] text-[calc(11rem/14)] text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
            >
              <RotateCcw className="size-[calc(12rem/14)]" />
              <span>{hiddenCoworkers.length}</span>
            </MenuTrigger>
            <MenuPopup align="end">
              {hiddenCoworkers.map((item) => (
                <MenuItem
                  key={item.id}
                  onClick={() => useSessionsStore.getState().selectTab(parentId, item.id)}
                >
                  {item.title || item.coworkerName || item.id}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        )}
        <button
          type="button"
          title={t('Add collaborator')}
          aria-label={t('Add collaborator')}
          disabled={!parentStarted}
          onClick={() => setHiring(true)}
          className="ml-[calc(2rem/14)] flex size-[calc(24rem/14)] shrink-0 items-center justify-center rounded-[calc(6rem/14)] text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground disabled:opacity-40"
        >
          <Plus className="size-[calc(14rem/14)]" />
        </button>
      </div>
      {trailing}
      {hiring && <HireCoworkerDialog parentId={parentId} onClose={() => setHiring(false)} />}
      <ConfirmDialog
        open={Boolean(dismissTarget)}
        onOpenChange={(open) => {
          if (!open) setDismissId(null);
        }}
        title={t('Dismiss {{name}}?', {
          name: dismissTarget?.title || dismissTarget?.coworkerName || '',
        })}
        description={t(
          'This ends the collaborator session and stops its work. Closing a tab only hides the view.'
        )}
        confirmLabel={t('Dismiss collaborator')}
        onConfirm={() => {
          if (dismissTarget)
            void useSessionsStore.getState().dismissCoworkerFromUI(parentId, dismissTarget.id);
        }}
      />
    </div>
  );
}

function RenameableTab({
  id,
  active,
  label,
  renameTitle,
  className,
  leading,
  trailing,
  reloadDisabled,
  reloading,
  onSelect,
  onViewProcess,
  onCloseConversation,
  onDismiss,
}: {
  id: string;
  /** 当前正在显示的页签；选中态同时由 aria-selected 暴露给辅助技术 */
  active: boolean;
  label: string;
  /** 重命名时编辑的标题；缺省与 label 相同 */
  renameTitle?: string;
  className: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  /** 重读在途 / spawn 中禁用菜单项，避免与在途读取叠加 */
  reloadDisabled: boolean;
  reloading: boolean;
  onSelect: () => void;
  onViewProcess?: () => void;
  onCloseConversation?: () => void;
  onDismiss?: () => void;
}) {
  const { t } = useI18n();
  const [renaming, setRenaming] = React.useState(false);
  const tab = (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={className}
      onClick={() => {
        if (!renaming) onSelect();
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setRenaming(true);
      }}
    >
      {leading}
      {renaming ? (
        <ConversationTitleEdit
          title={renameTitle ?? label}
          className="max-w-48 text-[calc(11rem/14)]"
          onCommit={(title) => {
            useSessionsStore.getState().renameConversation(id, title);
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <span className="max-w-48 truncate">{label}</span>
      )}
      {trailing}
    </button>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger render={tab as React.ReactElement<Record<string, unknown>>} />
      <ContextMenuPopup className="min-w-36">
        {onViewProcess && (
          <ContextMenuItem onClick={onViewProcess}>{t('View process')}</ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => setRenaming(true)}>
          <Pencil />
          {t('Rename')}
        </ContextMenuItem>
        {onCloseConversation && (
          <ContextMenuItem onClick={onCloseConversation}>
            {t('Close conversation view')}
          </ContextMenuItem>
        )}
        {onDismiss && (
          <ContextMenuItem variant="destructive" onClick={onDismiss}>
            {t('Dismiss collaborator')}
          </ContextMenuItem>
        )}
        <ContextMenuItem
          disabled={reloadDisabled}
          onClick={() => void reloadConversationFromMenu(id, t)}
        >
          <RefreshCw className={reloading ? 'animate-spin' : undefined} />
          {t('Reload conversation')}
        </ContextMenuItem>
      </ContextMenuPopup>
    </ContextMenu>
  );
}

/** 手动雇佣弹窗：名字 + agent 类型;主 agent 经 worker 通知感知新同事 */
function HireCoworkerDialog({ parentId, onClose }: { parentId: string; onClose: () => void }) {
  const { t } = useI18n();
  const agentTypes = useSettingsStore((state) => state.agentTypes);
  const disabledBuiltinAgentTypes = useSettingsStore((state) => state.disabledBuiltinAgentTypes);
  const designEnabled = useSettingsStore((state) => state.designEnabled);
  const disabledBuiltins = effectiveDisabledBuiltinAgentTypes({
    disabledBuiltinAgentTypes,
    designEnabled,
  });
  const [name, setName] = React.useState('');
  const [agentType, setAgentType] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [hiring, setHiring] = React.useState(false);
  // 与 main 下发口径一致：内置(过滤已关闭)+ 自定义(同名覆盖内置，trim+小写同口径)
  const customNames = new Set(agentTypes.map((entry) => entry.name.trim().toLowerCase()));
  const typeNames = [
    ...BUILTIN_AGENT_TYPES.filter(
      (type) => !disabledBuiltins.includes(type.name) && !customNames.has(type.name)
    ).map((type) => type.name),
    ...agentTypes.map((entry) => entry.name),
  ];
  const typeItems = [
    { value: '', label: t('General purpose') },
    ...typeNames.map((typeName) => ({ value: typeName, label: typeName })),
  ];

  const hire = async () => {
    if (hiring || !name.trim()) return;
    setHiring(true);
    setError(null);
    try {
      const failed = await useSessionsStore
        .getState()
        .hireCoworker(parentId, name.trim(), agentType || undefined);
      if (failed) setError(failed);
      else onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setHiring(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !hiring && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('Add collaborator')}</DialogTitle>
          <DialogDescription>
            {t(
              'A persistent collaborator can receive follow-up messages. One-off tasks are dispatched by the agent and viewed in Agents.'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <Field>
            <FieldLabel>{t('Collaborator name')}</FieldLabel>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="reviewer"
              disabled={hiring}
              autoFocus
            />
            <p className="text-[calc(11rem/14)] text-muted-foreground">
              {t('The name is a label; choose the role separately below.')}
            </p>
          </Field>
          <Field>
            <FieldLabel>{t('Role')}</FieldLabel>
            <Select
              items={typeItems}
              value={agentType}
              onValueChange={(value) => setAgentType(value ?? '')}
              disabled={hiring}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup zIndex={Z_INDEX.DROPDOWN_IN_MODAL}>
                {typeItems.map((item) => (
                  <SelectItem key={item.value || 'general'} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Field>
          {error && <p className="text-destructive text-[calc(11rem/14)]">{error}</p>}
          <div className="h-1" />
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={hiring}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void hire()} disabled={hiring || !name.trim()}>
            {hiring ? t('Adding collaborator…') : t('Add collaborator')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
