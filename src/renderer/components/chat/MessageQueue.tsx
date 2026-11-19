import { Check, Images, Pencil, Send, SquareX, Undo2, X } from 'lucide-react';
import { useEffect } from 'react';
import { create } from 'zustand';
import { useI18n } from '@/i18n';
import { hasPendingDeviceAccess, usePendingDeviceAccess } from '@/stores/deviceAccess';
import type { QueuedMessage } from '@/stores/sessions';
import { useSessionsStore } from '@/stores/sessions';
import { canSaveQueuedEdit, queuedAttachmentLabel } from './queueEdit';

// Keep one unfinished edit per conversation, including while its queue is unmounted.
interface QueueEdit {
  id: string;
  text: string;
}
const useQueueEdits = create<Map<string, QueueEdit>>(() => new Map());
function setQueueEdit(conversationId: string, edit: QueueEdit | null) {
  useQueueEdits.setState((previous) => {
    const next = new Map(previous);
    if (edit) next.set(conversationId, edit);
    else next.delete(conversationId);
    return next;
  }, true);
}

/**
 * 排队消息区(grok build 形态):agent 干活时用户消息先入队,显示在输入框上方;
 * 每条可编辑/删除/立即发送(steer 插入当前轮);轮次结束后剩余的自动合并投递。
 */
export function MessageQueue({
  conversationId,
  queued,
}: {
  conversationId: string;
  queued: QueuedMessage[];
}) {
  const { t } = useI18n();
  const pending = usePendingDeviceAccess(conversationId);
  const edit = useQueueEdits((edits) => edits.get(conversationId));
  useEffect(() => {
    if (edit && !queued.some((message) => message.id === edit.id))
      setQueueEdit(conversationId, null);
  }, [conversationId, edit, queued]);
  if (queued.length === 0) return null;

  // A request can arrive after render but before an enabled control's event runs.
  const whenAllowed = (action: () => void) => () => {
    if (!hasPendingDeviceAccess(conversationId)) action();
  };
  const saveEdit = (message: QueuedMessage) => {
    if (!edit || hasPendingDeviceAccess(conversationId)) return;
    if (canSaveQueuedEdit(edit.text, message.images?.length ?? 0)) {
      useSessionsStore.getState().updateQueuedMessage(conversationId, message.id, edit.text.trim());
    }
    setQueueEdit(conversationId, null);
  };

  return (
    <div
      data-slot="message-queue"
      className="mb-[6px] flex flex-col rounded-[6px] border border-border/70 bg-muted/45 px-[8px] py-[4px] text-[calc(12rem/14)]"
    >
      {queued.map((message) => (
        <div key={message.id} className="flex min-h-[calc(28rem/14)] items-center gap-[8px]">
          <span className="shrink-0 text-[calc(11rem/14)] text-faint">{t('Queued')}</span>
          {edit?.id === message.id ? (
            <input
              value={edit.text}
              disabled={pending}
              onChange={(e) => {
                if (!hasPendingDeviceAccess(conversationId)) {
                  setQueueEdit(conversationId, { id: message.id, text: e.target.value });
                }
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || hasPendingDeviceAccess(conversationId)) return;
                if (e.key === 'Enter') saveEdit(message);
                if (e.key === 'Escape') setQueueEdit(conversationId, null);
              }}
              // biome-ignore lint/a11y/noAutofocus: 进入编辑态即聚焦是预期交互
              autoFocus
              className="h-6 min-w-0 flex-1 rounded border bg-transparent px-1.5 outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate">{message.text || '[image]'}</span>
          )}
          {queuedAttachmentLabel(message.images?.length ?? 0, t('attachments')) && (
            <span
              title={
                queuedAttachmentLabel(message.images?.length ?? 0, t('attachments')) ?? undefined
              }
              className="flex shrink-0 items-center gap-0.5 text-muted-foreground"
            >
              <Images className="h-3 w-3" />
              {message.images?.length}
            </span>
          )}
          {edit?.id === message.id ? (
            <button
              type="button"
              title={t('Save')}
              disabled={pending}
              onClick={() => saveEdit(message)}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          ) : (
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                title={t('Withdraw message')}
                aria-label={t('Withdraw message')}
                disabled={pending}
                onClick={whenAllowed(() =>
                  useSessionsStore
                    .getState()
                    .withdrawMessage(conversationId, { kind: 'queue', id: message.id })
                )}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <Undo2 className="h-3 w-3" />
              </button>
              <button
                type="button"
                title={t('Edit')}
                disabled={pending}
                onClick={whenAllowed(() =>
                  setQueueEdit(conversationId, { id: message.id, text: message.text })
                )}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                title={t('Send now')}
                disabled={pending}
                onClick={whenAllowed(() =>
                  useSessionsStore.getState().sendQueuedNow(conversationId, message.id)
                )}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <Send className="h-3 w-3" />
              </button>
              <button
                type="button"
                title={t('Interrupt and send now')}
                disabled={pending}
                onClick={whenAllowed(
                  () =>
                    void useSessionsStore
                      .getState()
                      .interruptAndSendQueued(conversationId, message.id)
                )}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <SquareX className="h-3 w-3" />
              </button>
              <button
                type="button"
                title={t('Remove')}
                onClick={() =>
                  useSessionsStore.getState().removeQueuedMessage(conversationId, message.id)
                }
                className="rounded p-0.5 text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
