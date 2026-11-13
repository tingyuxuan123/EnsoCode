/** 待投递完成通知的容量上限，包含溢出告知占用的一格。 */
export const REMINDER_QUEUE_LIMIT = 1000;

const OVERFLOW_NOTICE = /^\[Queue overflow\] (\d+) earlier background notifications were dropped/;

function overflowNotice(dropped: number): string {
  return (
    `[Queue overflow] ${dropped} earlier background notifications were dropped before delivery. ` +
    'The tasks were not stopped; check their current state (task_output, subagent list/report) before relying on them.'
  );
}

function droppedCount(text: string | undefined): number {
  const match = OVERFLOW_NOTICE.exec(text ?? '');
  const count = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

/** 入队；满了丢最旧并留一条累加告知。至少两格才能同时保留告知和最新结果。 */
export function enqueueReminder(
  queue: string[],
  text: string,
  limit = REMINDER_QUEUE_LIMIT
): boolean {
  if (!Number.isSafeInteger(limit) || limit < 2)
    throw new RangeError('Reminder capacity must be an integer >= 2');
  const previous = droppedCount(queue[0]);
  const incoming = droppedCount(text);
  if (previous) queue.shift();
  if (!incoming) queue.push(text);
  let dropped = Math.min(Number.MAX_SAFE_INTEGER, previous + incoming);
  const capacity = dropped || queue.length > limit ? limit - 1 : limit;
  const excess = Math.max(0, queue.length - capacity);
  if (excess) {
    queue.splice(0, excess);
    dropped = Math.min(Number.MAX_SAFE_INTEGER, dropped + excess);
  }
  if (dropped) queue.unshift(overflowNotice(dropped));
  return excess > 0;
}
