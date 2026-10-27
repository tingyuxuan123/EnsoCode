import { coworkerTabTone } from '@shared/conversationDotTone';
import { BUILTIN_AGENT_TYPES } from '@shared/types/assets';
import { Bot, Ellipsis, MessagesSquare, Pencil, Plus, RefreshCw, RotateCcw, X } from 'lucide-react';
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

  const tabClass = (active: boolean) =>
    cn(
      // 下划线页签：激活项底部 2px 强调色，非激活只在悬停时出浅底
      'relative flex h-full min-w-0 shrink-0 items-center gap-1.5 px-3 text-[13px] transition-colors',
      active
        ? 'font-medium text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:rounded-full after:bg-brand'
        : 'text-muted-foreground hover:text-foreground'
    );

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b px-4">
      <div className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        <RenameableTab
          id={parentId}
          // 会话标题已在窗口标题栏；页签只标明主会话，重命名仍编辑真实标题
          label={t('Main conversation')}
          renameTitle={parentTitle || t('New conversation')}
          className={tabClass(displayedId === parentId)}
          leading={<MessagesSquare className="size-3.5 shrink-0" />}
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
            <div key={coworker.id} className="group/tab flex h-full shrink-0 items-center">
              <RenameableTab
                id={coworker.id}
                label={
                  coworker.title ||
                  coworker.child?.agentInstanceName ||
                  coworker.coworkerName ||
                  coworker.id
                }
                className={cn(
                  tabClass(displayedId === coworker.id),
                  displayedId !== coworker.id && 'group-hover/tab:text-foreground'
                )}
                leading={<Bot className="size-3.5 shrink-0" />}
                trailing={
                  <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center">
                    <ConversationStatusIndicator tone={tone} size="sm" />
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
              <Menu>
                <MenuTrigger
                  aria-label={t('Collaborator actions')}
                  title={t('Collaborator actions')}
                  className="rounded p-1 text-muted-foreground opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100 hover:bg-accent"
                >
                  <Ellipsis className="size-3.5" />
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
                className="rounded p-1 text-muted-foreground opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100 hover:bg-accent hover:text-foreground"
                onClick={() => useSessionsStore.getState().closeCoworkerTab(parentId, coworker.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        {hiddenCoworkers.length > 0 && (
          <Menu>
            <MenuTrigger
              aria-label={t('Reopen collaborator')}
              title={t('Reopen collaborator')}
              className="flex shrink-0 items-center gap-1 rounded-md p-1 text-xs text-muted-foreground hover:bg-accent"
            >
              <RotateCcw className="size-3.5" />
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
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
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
          className="max-w-48 text-xs"
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
  const disabledBuiltins = useSettingsStore((state) => state.disabledBuiltinAgentTypes);
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
            <p className="text-xs text-muted-foreground">
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
          {error && <p className="text-destructive text-xs">{error}</p>}
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
