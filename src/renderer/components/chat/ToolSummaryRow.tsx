import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { QueuedSummaryContent } from './QueuedSummaryContent';
import type { StepIconComponent } from './StepIcons';

/**
 * 工具 / 思考 / 分组的一行摘要：
 * 22px 图标徽标 · 类型词 · 弱化摘要 · 尾部（+N/-N）· 状态，行面带轻量悬停反馈。
 * 运行中图标轻呼吸、类型词扫光；animate 时摘要按 contentKey 滚动替换。
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
  icon?: StepIconComponent;
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
  const interactive = canToggle || Boolean(onActivate);
  const body = (
    <>
      {Icon && (
        <span
          data-step-icon=""
          data-state={running ? 'running' : failed ? 'failed' : 'idle'}
          className={cn(
            'inline-flex size-[calc(22rem/14)] shrink-0 items-center justify-center rounded-[calc(7rem/14)] border transition-colors duration-150',
            running
              ? 'codekiln-step-icon-live'
              : failed
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : expanded
                  ? 'border-border/90 bg-secondary/90 text-foreground/85'
                  : 'border-border/55 bg-secondary/50 text-muted-foreground/80 group-hover/tool-summary:border-border/90 group-hover/tool-summary:bg-secondary/90 group-hover/tool-summary:text-foreground/85'
          )}
        >
          <Icon aria-hidden className="size-[calc(13rem/14)] shrink-0" />
        </span>
      )}
      <span
        className={cn(
          'shrink-0 whitespace-nowrap font-medium text-[calc(13rem/14)] transition-colors',
          running
            ? 't-shimmer'
            : failed
              ? 'text-destructive/90'
              : 'text-foreground/78 group-hover/tool-summary:text-foreground'
        )}
        data-text={running ? kind : undefined}
      >
        {kind}
      </span>
      {hasContent && (
        <span className="flex min-w-0 max-w-full items-center gap-1.5 text-[calc(12.5rem/14)] text-muted-foreground/80 transition-colors group-hover/tool-summary:text-muted-foreground">
          {separator && <span className="shrink-0 text-muted-foreground/45">·</span>}
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
            'size-3.5 shrink-0 text-muted-foreground/65 transition-[opacity,transform,color] duration-200 ease-out',
            expanded
              ? 'rotate-90 text-foreground/75 opacity-90'
              : 'opacity-40 group-hover/tool-summary:text-foreground/75 group-hover/tool-summary:opacity-100'
          )}
        />
      )}
    </>
  );
  const className = cn(
    'codekiln-step-trigger group/tool-summary inline-flex min-h-[calc(30rem/14)] max-w-full min-w-0 items-center gap-2 rounded-[calc(8rem/14)] py-1 text-left text-[calc(13rem/14)] transition-[background-color,color] duration-150',
    interactive
      ? 'cursor-pointer hover:bg-secondary/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      : 'cursor-default'
  );
  return (
    <div className="flex min-w-0 items-center gap-1">
      {interactive ? (
        <button
          type="button"
          onClick={onActivate ?? onToggle}
          aria-label={onActivate ? actionLabel : undefined}
          aria-expanded={onActivate ? undefined : expanded}
          title={title}
          className={className}
        >
          {body}
        </button>
      ) : (
        <div className={className} title={title}>
          {body}
        </div>
      )}
      {actions}
    </div>
  );
}

/** 展开后的子项容器：左侧细竖线，子项缩进对齐 22px 图标中线 */
export function ToolGroupChildren({ children }: { children: ReactNode }) {
  return (
    <div className="ml-[calc(10rem/14)] flex flex-col gap-1.5 border-l border-border/75 pl-3.5">
      {children}
    </div>
  );
}
