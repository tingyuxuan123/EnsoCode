import type { CoworkerTabTone } from '@shared/conversationDotTone';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

/** 会话状态指示：区分运行（迷你 Enso 环）、待审批（脉冲环）、等待回答（问号徽标）、失败（静态叹号）、未读（完成绿点）与空闲占位。 */
export type ConversationIndicatorTone = CoworkerTabTone | 'unread';

const ICON_SIZE = { sm: 'size-[calc(14rem/14)]', md: 'size-[calc(16rem/14)]' } as const;
const UNREAD_SIZE = { sm: 'size-[calc(7rem/14)]', md: 'size-[calc(8rem/14)]' } as const;
const RING_SIZE = { sm: 'size-[calc(7rem/14)]', md: 'size-[calc(9rem/14)]' } as const;

export function ConversationStatusIndicator({
  tone,
  size = 'sm',
  idleVariant = 'ring',
  active = false,
  title,
  className,
}: {
  tone: ConversationIndicatorTone;
  size?: keyof typeof ICON_SIZE;
  /** 'subtle-dot' 用于侧栏会话列（方案 A），'ring' 用于页签与工作区徽标 */
  idleVariant?: 'ring' | 'subtle-dot';
  active?: boolean;
  /** 非 waiting 态的悬停提示（waiting 态固定为「等待你回答」） */
  title?: string;
  className?: string;
}) {
  const { t } = useI18n();

  if (tone === 'running') {
    return (
      <span
        data-slot="conversation-status"
        data-tone={tone}
        title={title}
        className={cn(
          'inline-flex shrink-0 items-center justify-center',
          ICON_SIZE[size],
          className
        )}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true" className="size-full overflow-visible">
          <circle cx="7" cy="7" r="4.8" className="codekiln-status-track" />
          <circle cx="7" cy="7" r="4.8" className="codekiln-status-orbit" />
          <circle cx="7" cy="7" r="1.65" className="codekiln-status-core" />
        </svg>
      </span>
    );
  }

  if (tone === 'attention') {
    return (
      <span
        data-slot="conversation-status"
        data-tone={tone}
        title={title}
        className={cn(
          'inline-flex shrink-0 items-center justify-center',
          ICON_SIZE[size],
          className
        )}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true" className="size-full overflow-visible">
          <circle cx="7" cy="7" r="4.6" className="codekiln-status-attention-ring" />
          <circle cx="7" cy="7" r="2.75" className="codekiln-status-attention-core" />
        </svg>
      </span>
    );
  }

  if (tone === 'waiting') {
    const label = t('Waiting for your answer');
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        data-slot="conversation-status"
        data-tone={tone}
        className={cn(
          'codekiln-status-waiting inline-flex shrink-0 items-center justify-center',
          ICON_SIZE[size],
          className
        )}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true" className="size-full overflow-visible">
          <circle cx="7" cy="7" r="5.3" className="codekiln-status-waiting-ring" />
          <path
            d="M5.65 5.45a1.45 1.45 0 0 1 2.75.65c0 .9-1.4 1.1-1.4 2.05"
            className="codekiln-status-waiting-glyph"
          />
          <circle cx="7" cy="10.05" r="0.72" className="codekiln-status-waiting-dot" />
        </svg>
      </span>
    );
  }

  if (tone === 'failed') {
    return (
      <span
        data-slot="conversation-status"
        data-tone={tone}
        title={title}
        className={cn(
          'inline-flex shrink-0 items-center justify-center',
          ICON_SIZE[size],
          className
        )}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true" className="size-full overflow-visible">
          <circle cx="7" cy="7" r="5.3" className="codekiln-status-failed-ring" />
          <line x1="7" y1="4.35" x2="7" y2="7.55" className="codekiln-status-failed-glyph" />
          <circle cx="7" cy="9.65" r="0.75" className="codekiln-status-failed-dot" />
        </svg>
      </span>
    );
  }

  if (tone === 'unread') {
    return (
      <span
        data-slot="conversation-status"
        data-tone={tone}
        title={title}
        className={cn('codekiln-status-unread shrink-0 rounded-full', UNREAD_SIZE[size], className)}
      />
    );
  }

  if (idleVariant === 'subtle-dot') {
    return (
      <span
        data-slot="conversation-status"
        data-tone={tone}
        data-active={active ? 'true' : undefined}
        title={title}
        className={cn(
          'codekiln-status-idle-dot shrink-0 rounded-full transition-colors duration-150',
          active
            ? 'size-[calc(5rem/14)] bg-foreground/65'
            : 'size-[calc(4rem/14)] bg-muted-foreground/28 group-hover:bg-muted-foreground/55',
          className
        )}
      />
    );
  }

  return (
    <span
      data-slot="conversation-status"
      data-tone={tone}
      title={title}
      className={cn(
        'codekiln-status-idle-ring shrink-0 rounded-full border-[1.25px] border-muted-foreground/45',
        RING_SIZE[size],
        className
      )}
    />
  );
}
