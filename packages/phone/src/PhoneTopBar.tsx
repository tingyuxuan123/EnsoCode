import { ArrowLeft, ChevronDown, EllipsisVertical, Menu, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 每页顶部一行：左边返回/抽屉/关闭，中间 17px 标题 + 12px 副行，右边放这一页自己的按钮。
 * 没有背景，也不画底线（设计稿 `TopBar`）。圆钮 48px，可点区域 44 以上。
 */
export function PhoneTopBar({
  lead,
  onLead,
  leadLabel,
  title,
  detail,
  detailMenu = false,
  onDetail,
  className,
  children,
}: {
  lead: 'menu' | 'back' | 'close' | 'none';
  onLead?(): void;
  leadLabel?: string;
  title: string;
  detail?: ReactNode;
  /** 副行末尾一个 chevron-down：可点开切换（会话设置） */
  detailMenu?: boolean;
  onDetail?(): void;
  className?: string;
  children?: ReactNode;
}) {
  const LeadIcon = lead === 'back' ? ArrowLeft : lead === 'close' ? X : Menu;
  const label =
    leadLabel ?? (lead === 'back' ? '返回' : lead === 'close' ? '关闭' : '打开会话列表');
  const heading = (
    <>
      <div className="truncate text-[17px] leading-[22px] font-medium">{title}</div>
      {detail ? (
        <div className="flex min-w-0 items-center gap-0.5 text-[12px] leading-4 text-dim">
          <span className="truncate">{detail}</span>
          {detailMenu && <ChevronDown className="size-3.5 shrink-0" aria-hidden />}
        </div>
      ) : null}
    </>
  );
  return (
    <header
      className={cn('phone-top-bar relative flex shrink-0 items-center gap-1 pr-3 pl-1', className)}
    >
      {lead === 'none' || !onLead ? (
        <span className="size-12 shrink-0" />
      ) : (
        <button
          type="button"
          onClick={onLead}
          aria-label={label}
          className="flex size-12 shrink-0 items-center justify-center rounded-full text-ink transition-colors active:bg-card2"
        >
          <LeadIcon className="size-6" aria-hidden />
        </button>
      )}
      {onDetail ? (
        <button
          type="button"
          onClick={onDetail}
          className="min-w-0 flex-1 text-left"
          aria-label={`${title} 的设置`}
        >
          {heading}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{heading}</div>
      )}
      {children}
    </header>
  );
}

/** 顶栏右侧的圆形动作钮（48px） */
export function TopBarAction({
  label,
  title,
  onClick,
  disabled,
  children,
}: {
  label: string;
  /** 悬停/长按提示，缺省用 label */
  title?: string;
  onClick?(): void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className="flex size-12 shrink-0 items-center justify-center rounded-full text-ink transition-colors active:bg-card2 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** ⋯ 会话菜单入口 */
export const topBarMenuIcon = <EllipsisVertical className="size-6" aria-hidden />;
