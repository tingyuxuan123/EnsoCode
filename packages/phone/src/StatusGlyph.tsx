import { CircleHelp, Loader2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 状态只在需要你看一眼时出现：运行中蓝弧、等你回复黄色呼吸问号、出错红色叹号。
 * 完成和空闲不画符号（设计稿 `StatusGlyph`）。
 */
export type RowTone = 'running' | 'waiting' | 'error' | 'done' | 'idle';

type ToneInput = {
  status: string;
  unread?: boolean;
  pendingAskCount?: number;
  pendingApprovalCount?: number;
};

/** 会话状态 → 一个符号档位。等你的优先级最高，其次出错、运行中。 */
export function rowTone(input: ToneInput): RowTone {
  const waiting = (input.pendingAskCount ?? 0) > 0 || (input.pendingApprovalCount ?? 0) > 0;
  if (waiting) return 'waiting';
  if (input.status === 'failed') return 'error';
  if (input.status === 'running') return 'running';
  if (input.unread) return 'done';
  return 'idle';
}

export function StatusGlyph({ tone, size = 15 }: { tone: RowTone; size?: number }) {
  if (tone === 'running') {
    return (
      <Loader2
        aria-label="运行中"
        className="shrink-0 animate-spin text-blue"
        style={{ width: size, height: size }}
      />
    );
  }
  if (tone === 'waiting') {
    return (
      <CircleHelp
        aria-label="等你处理"
        className="shrink-0 animate-pulse text-yellow"
        style={{ width: size, height: size }}
      />
    );
  }
  if (tone === 'error') {
    return (
      <TriangleAlert
        aria-label="出错"
        className="shrink-0 text-red"
        style={{ width: size, height: size }}
      />
    );
  }
  return null;
}

/** 等你那条整行黄底 */
export const waitingRowClass = 'bg-[color-mix(in_srgb,var(--yellow)_9%,transparent)]';

export const rowTitleClass = (tone: RowTone): string =>
  cn(
    'block truncate text-[16px] leading-[22px]',
    tone === 'waiting' ? 'font-semibold' : 'font-medium'
  );
