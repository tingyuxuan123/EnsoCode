import type { TimelineItem } from '@/stores/sessions/timeline';

/** Exponential damping time constant (ms) for smooth upward streaming follow. */
export const SMOOTH_FOLLOW_TAU_MS = 72;
/** Snap directly to target once remaining gap is sub-pixel. */
export const SMOOTH_FOLLOW_SNAP_PX = 0.75;
/** Pre-advance oversized gaps so huge output bursts stay responsive before smoothly landing. */
export const SMOOTH_FOLLOW_MAX_GLIDE_PX = 520;
const SMOOTH_FOLLOW_TAIL_PX = 240;
const USER_SCROLL_UP_TOLERANCE_PX = 2;

/**
 * Computes the next scrollTop for a frame-rate-independent exponential glide toward bottom.
 * Identical physical velocity on 60Hz, 120Hz, and 144Hz displays, with zero overshoot.
 */
export function nextSmoothScrollTop(
  current: number,
  target: number,
  dtMs: number,
  reducedMotion = false
): { next: number; done: boolean } {
  const gap = target - current;
  if (gap <= SMOOTH_FOLLOW_SNAP_PX) {
    return { next: Math.max(current, target), done: true };
  }
  if (reducedMotion) {
    return { next: target, done: true };
  }
  const base = gap > SMOOTH_FOLLOW_MAX_GLIDE_PX ? target - SMOOTH_FOLLOW_TAIL_PX : current;
  const clampedDt = Math.max(1, Math.min(64, Number.isFinite(dtMs) ? dtMs : 16));
  const alpha = 1 - Math.exp(-clampedDt / SMOOTH_FOLLOW_TAU_MS);
  const next = base + (target - base) * alpha;
  if (target - next <= SMOOTH_FOLLOW_SNAP_PX) {
    return { next: target, done: true };
  }
  return { next, done: false };
}

/** True only when scrollTop genuinely moved upward (user scrolled away), never on scrollHeight growth. */
export function isUserScrollUp(prevScrollTop: number, nextScrollTop: number): boolean {
  return nextScrollTop < prevScrollTop - USER_SCROLL_UP_TOLERANCE_PX;
}

/**
 * Finds newly formed group/worklog keys that replace or wrap items already visible on screen,
 * so in-place folding upgrades (e.g. 1 search -> "2 searches" or live worklog header) never flash.
 */
export function findSuppressedEnterKeys(
  folded: readonly TimelineItem[],
  seenKeys: ReadonlySet<string>
): Set<string> {
  const suppressed = new Set<string>();
  for (const item of folded) {
    if (seenKeys.has(item.key)) continue;
    if (item.kind !== 'tool-group') continue;
    if (item.worklog && item.key.startsWith('worklog-')) {
      const userKey = item.key.slice('worklog-'.length);
      if (seenKeys.has(userKey)) {
        suppressed.add(item.key);
        continue;
      }
    }
    if (item.key.startsWith('group-') && seenKeys.has(item.key.slice('group-'.length))) {
      suppressed.add(item.key);
      continue;
    }
    if (item.children.some((child) => seenKeys.has(child.key))) {
      suppressed.add(item.key);
    }
  }
  return suppressed;
}
