import { cn } from '@/lib/utils';

/** 上下文进度条转为警示色的阈值 */
const WARNING_PERCENT = 70;

/**
 * 半程阈值：0–49% 用最淡的一档，50% 起提亮一档，色相不变。
 * 为什么不是加一档颜色：70% 的黄已经意味着「该看一看了」，50% 只是「用了一半」，
 * 换色相会把正常的半程误读成警报；而 12px 的环上 40%/50%/60% 的弧长几乎分不出来，
 * 只靠弧长读不出「过半」。提亮一档既不改语义，又能和刚开聊区分开。
 */
const HALF_PERCENT = 50;

/** 圆环的半径与线宽（viewBox 单位）：14px 显示时环宽约 1.75px，和图标笔画同量级。 */
const RING_RADIUS = 5;
const RING_STROKE = 1.75;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** 把任意输入夹到 0–100，非有限值当 0，避免 NaN 写进 style。 */
function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

function toneOf(percent: number, critical: boolean): 'critical' | 'warning' | 'half' | 'normal' {
  if (critical) return 'critical';
  if (percent >= WARNING_PERCENT) return 'warning';
  return percent >= HALF_PERCENT ? 'half' : 'normal';
}

/**
 * 上下文占用指示器，比纯数字更直观地传达「还剩多少」。
 *
 * `bar` 是细横条（旧形态，保留给其他调用方）；`ring` 是 tray 上用的圆环，
 * 弧长按占比画、颜色随警戒等级变。
 */
export function ContextMeter({
  percent,
  critical,
  variant = 'bar',
}: {
  percent: number;
  critical: boolean;
  variant?: 'bar' | 'ring';
}) {
  const tone = toneOf(clampPercent(percent), critical);
  if (variant === 'ring') {
    const arc = (clampPercent(percent) / 100) * RING_CIRCUMFERENCE;
    return (
      <span
        aria-hidden
        data-slot="context-meter"
        data-variant="ring"
        className={cn(
          'shrink-0',
          tone === 'critical'
            ? 'text-destructive'
            : tone === 'warning'
              ? 'text-warning'
              : tone === 'half'
                ? 'text-muted-foreground'
                : 'text-muted-foreground/60'
        )}
      >
        <svg viewBox="0 0 12 12" aria-hidden className="size-[calc(12rem/14)] -rotate-90">
          <circle
            cx="6"
            cy="6"
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.18}
            strokeWidth={RING_STROKE}
          />
          <circle
            cx="6"
            cy="6"
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${RING_CIRCUMFERENCE}`}
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden
      data-slot="context-meter"
      data-variant="bar"
      className="h-[calc(4rem/14)] w-[calc(72rem/14)] shrink-0 overflow-hidden rounded-full bg-control"
    >
      <span
        className={cn(
          'block h-full rounded-full',
          tone === 'critical'
            ? 'bg-destructive'
            : tone === 'warning'
              ? 'bg-warning'
              : tone === 'half'
                ? 'bg-muted-foreground'
                : 'bg-muted-foreground/60'
        )}
        style={{ width: `${clampPercent(percent)}%` }}
      />
    </span>
  );
}
