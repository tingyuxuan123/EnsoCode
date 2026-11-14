import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OutboxItem } from './botOutbox';
import { rejectionText } from './readOnly';

interface Props {
  items: readonly OutboxItem[];
  /** 只读设备：重发也会被拦截，不给重试 */
  readOnly?: boolean;
  onRetry(deliveryId: string): void;
  onDiscard(deliveryId: string): void;
}

const STATUS_TEXT = { pending: '待发送', sending: '发送中…', failed: '发送失败' } as const;

/** Bot 聊天的离线待发队列：连上后按原 deliveryId 自动重发，失败的需手动重试 */
export function OutboxBar({ items, readOnly, onRetry, onDiscard }: Props) {
  if (items.length === 0) return null;
  return (
    // 设计稿 `outbox`：白卡一行，右侧给状态词；失败的那行红底 + 重试 + 删除
    <div className="mb-1.5 space-y-1.5">
      {items.map((item) => (
        <div
          key={item.deliveryId}
          className={cn(
            'flex items-center gap-2 rounded-[14px] px-3 py-2.5',
            item.status === 'failed'
              ? 'bg-red/5 shadow-[inset_0_0_0_1px_rgb(220_38_38/0.25)]'
              : 'bg-card'
          )}
        >
          <span
            className={cn(
              'min-w-0 flex-1 text-[13px] leading-[18px]',
              item.status === 'failed' ? 'whitespace-pre-wrap break-words select-text' : 'truncate'
            )}
          >
            {item.text || (item.images?.length ? `[${item.images.length} 张图片]` : '')}
            {/* 失败原因必须说清（尤其只读被拦下时），但压在第二行，不抢正文 */}
            {item.status === 'failed' && item.error && (
              <span className="mt-0.5 block text-[11px] leading-4 text-red">
                {STATUS_TEXT.failed}：{rejectionText(item.error) ?? item.error}
              </span>
            )}
          </span>
          <span
            className={cn(
              'shrink-0 text-[11px] leading-4',
              item.status === 'failed' ? 'text-red' : 'text-dim'
            )}
          >
            {item.error?.startsWith('outbox-discard')
              ? '移除消息'
              : item.error === 'delivery-unconfirmed'
                ? '结果未确认'
                : STATUS_TEXT[item.status]}
          </span>
          {item.status === 'failed' && !item.error?.startsWith('outbox-discard') && !readOnly && (
            <button
              type="button"
              aria-label="重试"
              onClick={() => onRetry(item.deliveryId)}
              className="shrink-0 text-[12px] leading-4 font-medium text-ink2"
            >
              重试
            </button>
          )}
          {item.status !== 'sending' && (
            <button
              type="button"
              aria-label="删除"
              disabled={item.error === 'outbox-discarding'}
              onClick={() => onDiscard(item.deliveryId)}
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-faint disabled:opacity-40"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
