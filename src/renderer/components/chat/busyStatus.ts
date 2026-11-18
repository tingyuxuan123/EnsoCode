import type { Locale } from '@shared/i18n';

export type BusyPhase = 'working' | 'thinking' | 'writing' | 'tool';

export interface BusyPhaseItem {
  kind: string;
  streaming?: boolean;
  state?: string;
  running?: boolean;
  exploring?: boolean;
  worklog?: { status?: string };
  children?: readonly BusyPhaseItem[];
}

/** Keep the footer label tied to the newest live row while the turn is still running. */
export function busyPhaseFor(item: BusyPhaseItem | undefined): BusyPhase {
  if (!item) return 'working';
  if (item.kind === 'thinking' && item.streaming) return 'thinking';
  if (item.kind === 'text' && item.streaming) return 'writing';
  if (item.kind === 'tool' && (item.state === 'running' || item.state === 'reviewing')) {
    return 'tool';
  }
  if (
    item.kind === 'tool-group' &&
    (item.running ||
      item.exploring ||
      item.worklog?.status === 'running' ||
      item.children?.some((child) => busyPhaseFor(child) === 'tool'))
  ) {
    return 'tool';
  }
  return 'working';
}

/** Seconds stay compact in English and gain readable units in Chinese. */
export function formatElapsed(ms: number, locale: Locale): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const whole = Math.round(safeMs / 1000);
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  if (locale === 'zh') {
    return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${whole} 秒`;
  }
  return minutes > 0 ? `${minutes}m${seconds}s` : `${whole}s`;
}
