import { ChevronRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { QueuedSummaryContent } from './QueuedSummaryContent';

/**
 * 工具 / 思考 / 分组的一行摘要（对齐 ZCode ToolSummaryRow）：
 * 16px 浅色图标 · 类型词 · 弱化摘要 · 尾部（+N/-N）· 状态，chevron 只在悬停或展开时出现。
 * 运行中类型词扫光；animate 时摘要按 contentKey 滚动替换。
 */
export function ToolSummaryRow({
  icon: Icon,
  kind,
  summary,
  trailing,
  status,
  running = false,
  failed = false,
  expanded = false,
  canToggle = true,
  animate = false,
  contentKey,
  refreshVersion,
  separator,
  title,
  onToggle,
  onActivate,
  actionLabel,
  actions,
}: {
  icon?: LucideIcon;
  kind: string;
  summary?: ReactNode;
  trailing?: ReactNode;
  status?: ReactNode;
  running?: boolean;
  failed?: boolean;
  expanded?: boolean;
  canToggle?: boolean;
  animate?: boolean;
  contentKey?: string;
  refreshVersion?: string;
  separator?: boolean;
  title?: string;
  onToggle?: () => void;
  /** 只读详情导航不是折叠动作，不能带 aria-expanded 或展开箭头。 */
  onActivate?: () => void;
  actionLabel?: string;
  /** 行尾的独立按钮（侧栏打开、移到后台等），不参与展开点击 */
  actions?: ReactNode;
}) {
  const hasContent = summary != null || trailing != null || status != null;
  const body = (
    <>
      {Icon && <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />}
      <span
        className={cn(
          'shrink-0 whitespace-nowrap font-medium',
          running ? 't-shimmer' : failed ? 'text-destructive/80' : 'text-muted-foreground/70'
        )}
        data-text={running ? kind : undefined}
      >
        {kind}
      </span>
      {hasContent && (
        <span className="flex min-w-0 max-w-full items-center gap-2 text-muted-foreground/70">
          {separator && <span className="shrink-0">·</span>}
          <QueuedSummaryContent
            contentKey={contentKey ?? `${kind}:${String(title ?? '')}`}
            refreshVersion={refreshVersion}
            primary={summary}
            trailing={trailing}
            enabled={animate && !expanded}
          />
          {status}
        </span>
      )}
      {canToggle && !onActivate && (
        <ChevronRight
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-muted-foreground/60 transition-[opacity,transform] duration-200 ease-out',
            expanded ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/tool-summary:opacity-100'
          )}
        />
      )}
    </>
  );
  const className =
    'group/tool-summary inline-flex min-h-6 max-w-full min-w-0 items-center gap-2 text-left text-sm transition-colors';
  return (
    <div className="flex min-w-0 items-center gap-1">
      {canToggle || onActivate ? (
        <button
          type="button"
          onClick={onActivate ?? onToggle}
          aria-label={onActivate ? actionLabel : undefined}
          aria-expanded={onActivate ? undefined : expanded}
          title={title}
          className={cn(
            className,
            'cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
        >
          {body}
        </button>
      ) : (
        <div className={cn(className, 'cursor-default')} title={title}>
          {body}
        </div>
      )}
      {actions}
    </div>
  );
}

/** 展开后的子项容器：左侧细竖线，子项缩进（对齐 ZCode 分组展开体） */
export function ToolGroupChildren({ children }: { children: ReactNode }) {
  return <div className="ml-2 flex flex-col gap-2 border-l border-border pl-3.5">{children}</div>;
}
