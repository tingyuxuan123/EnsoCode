export const SUMMARY_ROLL_TRANSITION_MS = 300;
export const SUMMARY_ROLL_HOLD_MS = 500;
export const SUMMARY_ROLL_TOTAL_MS = SUMMARY_ROLL_TRANSITION_MS + SUMMARY_ROLL_HOLD_MS;
/** 计时器晚到超过这个值，说明主线程卡过：不再逐条补播旧摘要 */
const TIMER_DRIFT_SKIP_MS = 250;
/** 排队上限：当前显示之外只留「下一条」和「可插队的一条」 */
const MAX_PENDING = 2;

export interface SummarySnapshot<T> {
  key: string;
  refreshVersion?: string;
  primary: T;
  trailing?: T;
}

/** 计时器回调时实际要播的队列：卡顿后只播最新一条 */
export function resolveSummaryPlaybackQueue<T>(queue: readonly T[], timerDriftMs: number): T[] {
  return timerDriftMs > TIMER_DRIFT_SKIP_MS && queue.length > 1 ? queue.slice(-1) : [...queue];
}

/**
 * 入队：同 key 原位替换（持续变化的 +N/-N 只更新同一快照，不新增滚动项）；
 * 否则保留第一条待播，新摘要只替换第二格。
 */
export function enqueueSummary<T>(
  queue: readonly SummarySnapshot<T>[],
  next: SummarySnapshot<T>
): SummarySnapshot<T>[] {
  const existing = queue.findIndex((item) => item.key === next.key);
  if (existing >= 0) return queue.map((item, index) => (index === existing ? next : item));
  if (queue.length === 0) return [next];
  return [queue[0], next].slice(0, MAX_PENDING);
}

/** 同 key 的摘要只在尾部或显式版本变化时原位刷新，不重播滚动 */
export function shouldRefreshSummaryInPlace<T>(
  current: SummarySnapshot<T>,
  next: SummarySnapshot<T>
): boolean {
  return (
    current.key === next.key &&
    (current.trailing !== next.trailing || current.refreshVersion !== next.refreshVersion)
  );
}
