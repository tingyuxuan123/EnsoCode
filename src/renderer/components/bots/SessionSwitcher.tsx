import { menuThreads } from '@shared/bots/threads';
import type { BotChat } from '@shared/types/bot';
import type { BotSessionRecord } from '@shared/types/botIpc';
import { Check, ChevronDown, List } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/chat/ConfirmDialog';
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useBotsStore } from '@/stores/bots';
import { chatErrorText } from './botText';
import { SWITCHER_BUTTON, type SwitcherEntry, ThreadMarks, ThreadsDialog } from './ThreadSwitcher';

/** 私聊对话切换：切回旧对话即续用原会话；工作区换过的旧对话只能只读查看 */
export function SessionSwitcher({
  chat,
  botId,
  running,
  onView,
}: {
  chat: BotChat;
  botId: string;
  running: boolean;
  onView: (conversationId: string, title: string) => void;
}) {
  const { t } = useI18n();
  const [records, setRecords] = useState<BotSessionRecord[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const currentId = chat.sessions[botId]?.conversationId;
  const load = useCallback(() => {
    void window.electronAPI.bots.chatSessions(chat.id).then((result) => {
      if (result.ok) setRecords(result.sessions.filter((item) => item.botId === botId));
    });
  }, [chat.id, botId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 换会话或回合结束后标题 / 时间会变
  useEffect(load, [load, currentId, running]);

  const entries: (SwitcherEntry & { resumable: boolean })[] = records.map((record) => {
    const current = record.conversationId === currentId;
    return {
      id: record.conversationId,
      title: record.title ?? (current ? t('New conversation') : t('Untitled conversation')),
      preview: current || record.resumable ? '' : t('Workspace changed; view only'),
      activityAt: record.activityAt ?? (current ? Date.now() : 0),
      unread: false,
      running: current && running,
      resumable: record.resumable,
    };
  });
  const shown = menuThreads(entries, { currentId: currentId ?? '', rootId: currentId ?? '' });
  const hidden = entries.length - shown.length;
  const label = entries.find((entry) => entry.id === currentId)?.title ?? t('New conversation');

  const switchTo = async (id: string) => {
    const result = await window.electronAPI.bots.switchSession(chat.id, id);
    if (!result.ok) addToast({ type: 'error', title: chatErrorText(result.error, t) });
    await useBotsStore.getState().refreshChats();
    load();
  };
  const open = (id: string) => {
    const entry = entries.find((item) => item.id === id);
    if (!entry || id === currentId) return;
    if (!entry.resumable) onView(id, entry.title);
    else if (running) setConfirming(id);
    else void switchTo(id);
  };

  if (entries.length < 2) return null;
  return (
    <>
      <Menu onOpenChange={(value) => value && load()}>
        <MenuTrigger className={cn(SWITCHER_BUTTON, 'max-w-56')}>
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </MenuTrigger>
        <MenuPopup align="end" className="w-72">
          <MenuGroup>
            <MenuGroupLabel>{t('Conversations')}</MenuGroupLabel>
            {shown.map((entry) => (
              <MenuItem key={entry.id} onClick={() => open(entry.id)}>
                <Check className={cn(entry.id !== currentId && 'invisible')} />
                <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                {!entry.resumable && entry.id !== currentId && (
                  <span className="shrink-0 text-muted-foreground text-[calc(11rem/14)]">
                    {t('Read-only')}
                  </span>
                )}
                <ThreadMarks entry={entry} />
              </MenuItem>
            ))}
          </MenuGroup>
          {hidden > 0 && (
            <>
              <MenuSeparator />
              <MenuItem onClick={() => setListOpen(true)}>
                <List />
                {t('All conversations ({{n}})', { n: entries.length })}
              </MenuItem>
            </>
          )}
        </MenuPopup>
      </Menu>
      {listOpen && (
        <ThreadsDialog
          heading={t('Conversations')}
          placeholder={t('Search conversations...')}
          empty={t('No matching conversations')}
          entries={entries}
          currentId={currentId ?? ''}
          onClose={() => setListOpen(false)}
          onOpen={(id) => {
            setListOpen(false);
            open(id);
          }}
        />
      )}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(value) => !value && setConfirming(null)}
        title={t('Switch conversation?')}
        description={t('The reply in progress will be stopped.')}
        confirmLabel={t('Switch')}
        onConfirm={() => confirming && void switchTo(confirming)}
      />
    </>
  );
}
