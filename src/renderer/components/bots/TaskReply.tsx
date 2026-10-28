import { GROUP_TASK_TEXT_MAX } from '@shared/types/bot';
import { Loader2, Send } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { addToast } from '@/components/ui/toast';
import { type TFunction, useI18n } from '@/i18n';
import { effectiveKeybindings, formatBinding, isSendMessageKey } from '@/lib/keybindings';
import { cn } from '@/lib/utils';
import { useBotsStore } from '@/stores/bots';
import { useSettingsStore } from '@/stores/settings';

export function taskErrorText(error: string, t: TFunction): string {
  switch (error) {
    case 'invalid':
      return t('Check the title and details.');
    case 'disabled':
      return t('Bot mode is off.');
    default:
      return error;
  }
}

/** 任务卡回复（人）：失败提示原因；成功后刷新看板、委派与收件箱 */
export async function replyToTask(
  chatId: string,
  taskId: string,
  text: string,
  t: TFunction
): Promise<boolean> {
  const result = await window.electronAPI.bots.tasks.reply({ chatId, id: taskId, text });
  const store = useBotsStore.getState();
  void store.refreshTasks(chatId);
  void store.refreshDelegations();
  void store.refreshInbox();
  if (!result.ok)
    addToast({
      type: 'error',
      title: t('Reply not sent'),
      description: taskErrorText(result.error, t),
    });
  return result.ok;
}

/** 任务卡回复框：按「发送消息」快捷键发送，随内容长高；发送成功才清空 */
export function TaskReply({
  placeholder,
  onSend,
  className,
}: {
  placeholder: string;
  onSend: (text: string) => Promise<boolean>;
  className?: string;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const sendBinding = effectiveKeybindings(useSettingsStore((s) => s.keybindings))['send-message'];
  const send = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      if (await onSend(value)) setText('');
    } finally {
      setSending(false);
    }
  };
  return (
    <div className={cn('mt-1.5 flex items-end gap-1', className)}>
      <Textarea
        value={text}
        rows={1}
        size="sm"
        maxLength={GROUP_TASK_TEXT_MAX}
        placeholder={placeholder}
        aria-label={placeholder}
        title={sendBinding ? `${t('Send')} ${formatBinding(sendBinding)}` : undefined}
        disabled={sending}
        className="text-[calc(11rem/14)] [&_textarea]:max-h-32 [&_textarea]:min-h-0 [&_textarea]:resize-none"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (!event.nativeEvent.isComposing && isSendMessageKey(event, sendBinding)) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <Button
        size="icon-sm"
        variant={text.trim() ? 'default' : 'ghost'}
        aria-label={t('Send reply')}
        disabled={!text.trim() || sending}
        onClick={() => void send()}
      >
        {sending ? <Loader2 className="animate-spin" /> : <Send />}
      </Button>
    </div>
  );
}
