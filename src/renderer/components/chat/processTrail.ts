import type { TimelineItem } from '@/stores/sessions/timeline';

/** Duration (ms) during which a newly appended live process row plays its entrance motion. */
export const LIVE_ENTER_MS = 500;

function isNestedTimelineItem(item: TimelineItem | undefined): boolean {
  return (
    item !== undefined && (item.kind === 'tool' || item.kind === 'thinking') && item.nested === true
  );
}

/** Process rows sit in a tighter vertical trace than editorial assistant replies. */
export function isProcessTimelineItem(item: TimelineItem): boolean {
  return (
    item.kind === 'tool' ||
    item.kind === 'thinking' ||
    (item.kind === 'tool-group' && !item.worklog)
  );
}

/** Row bottom spacing: compact between consecutive process steps, airy around prose and worklogs. */
export function processRowGap(item: TimelineItem, next: TimelineItem | undefined): string {
  if (item.kind === 'tool-group' && item.worklog) return 'pb-5';
  if (isNestedTimelineItem(next)) return 'pb-2';
  if (isProcessTimelineItem(item) && next !== undefined && isProcessTimelineItem(next)) {
    return 'pb-1.5';
  }
  return 'pb-4';
}

/** Whether a top-level process row renders a 22px step-icon badge that can anchor a vertical rail. */
function isRailStepItem(item: TimelineItem): boolean {
  if (!isProcessTimelineItem(item) || isNestedTimelineItem(item)) return false;
  if (item.kind === 'tool-group') return !item.browser;
  if (item.kind === 'tool') {
    if (item.todos || item.name.startsWith('goal_')) return false;
    if (item.plan && item.state !== 'error') return false;
    if (item.designCards?.length || item.imagePath) return false;
  }
  return true;
}

/** Connect consecutive top-level process rows with a quiet vertical timeline rail. */
export function shouldShowProcessRail(item: TimelineItem, next: TimelineItem | undefined): boolean {
  return isRailStepItem(item) && next !== undefined && isRailStepItem(next);
}

/**
 * Track keys newly added while a turn is actively running so only live-arriving steps
 * play entrance motion (initial history load and scrollback never replay animations).
 */
export function collectLiveEnteredKeys(
  seenKeys: Set<string>,
  currentKeys: readonly string[],
  running: boolean,
  now: number,
  activeEnters: Map<string, number>,
  initialMount: boolean,
  suppressedKeys?: ReadonlySet<string>
): Set<string> {
  for (const [key, enteredAt] of activeEnters) {
    if (now - enteredAt >= LIVE_ENTER_MS) activeEnters.delete(key);
  }
  if (initialMount) {
    for (const key of currentKeys) seenKeys.add(key);
    return new Set();
  }
  for (const key of currentKeys) {
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    if (running && !suppressedKeys?.has(key)) activeEnters.set(key, now);
  }
  return new Set(activeEnters.keys());
}
