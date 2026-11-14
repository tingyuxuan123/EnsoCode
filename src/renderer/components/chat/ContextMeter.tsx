import { cn } from '@/lib/utils';

/** 上下文进度条转为警示色的阈值 */
const WARNING_PERCENT = 70;

/** 上下文占用进度条，比纯数字更直观地传达「还剩多少」。 */
export function ContextMeter({ percent, critical }: { percent: number; critical: boolean }) {
  return (
    <span
      aria-hidden
      data-slot="context-meter"
      className="h-[calc(4rem/14)] w-[calc(72rem/14)] shrink-0 overflow-hidden rounded-full bg-control"
    >
      <span
        className={cn(
          'block h-full rounded-full',
          critical
            ? 'bg-destructive'
            : percent >= WARNING_PERCENT
              ? 'bg-warning'
              : 'bg-muted-foreground/60'
        )}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </span>
  );
}
