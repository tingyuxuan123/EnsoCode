import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  enqueueSummary,
  resolveSummaryPlaybackQueue,
  SUMMARY_ROLL_TOTAL_MS,
  SUMMARY_ROLL_TRANSITION_MS,
  type SummarySnapshot,
  shouldRefreshSummaryInPlace,
} from './summaryRoll';

const ROLL_TRANSITION = {
  duration: SUMMARY_ROLL_TRANSITION_MS / 1000,
  ease: [0.4, 0, 0.2, 1],
} as const;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * 摘要滚动（对齐 ZCode QueuedSummaryContent）：contentKey 变化时新摘要从下方滚入、旧摘要向上滚出。
 * 每条至少停留 300ms 过渡 + 500ms，期间到达的摘要排队（最多 2 条）；主线程卡顿导致计时晚到时
 * 只播最新一条。同 key 的 trailing（如 +N/-N）或 refreshVersion 变化原位更新，不重播滚动。
 */
export function QueuedSummaryContent({
  contentKey,
  refreshVersion,
  primary,
  trailing,
  enabled,
}: {
  contentKey: string;
  refreshVersion?: string;
  primary: ReactNode;
  trailing?: ReactNode;
  enabled: boolean;
}) {
  const reducedMotion = useReducedMotion() === true;
  const animate = enabled && !reducedMotion;
  const snapshot: SummarySnapshot<ReactNode> = {
    key: contentKey,
    refreshVersion,
    primary,
    trailing,
  };
  const [displayed, setDisplayed] = useState(snapshot);
  const displayedRef = useRef(displayed);
  const queueRef = useRef<SummarySnapshot<ReactNode>[]>([]);
  const timerRef = useRef<number | null>(null);
  const animatingRef = useRef(false);
  const latestRef = useRef(snapshot);
  latestRef.current = snapshot;

  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在摘要身份 / 尾部 / 开关变化时调度，节点引用每次渲染都是新的
  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    const show = (next: SummarySnapshot<ReactNode>) => {
      displayedRef.current = next;
      setDisplayed(next);
    };
    const promote = (next: SummarySnapshot<ReactNode>) => {
      show(next);
      animatingRef.current = true;
      clearTimer();
      const expectedAt = now() + SUMMARY_ROLL_TOTAL_MS;
      timerRef.current = window.setTimeout(() => {
        animatingRef.current = false;
        timerRef.current = null;
        const [head, ...rest] = resolveSummaryPlaybackQueue(queueRef.current, now() - expectedAt);
        queueRef.current = rest;
        if (head) promote(head);
      }, SUMMARY_ROLL_TOTAL_MS);
    };
    const next = latestRef.current;
    if (!animate) {
      clearTimer();
      animatingRef.current = false;
      queueRef.current = [];
      show(next);
      return;
    }
    if (displayedRef.current.key === next.key) {
      if (shouldRefreshSummaryInPlace(displayedRef.current, next)) show(next);
      return;
    }
    if (animatingRef.current || queueRef.current.length > 0) {
      queueRef.current = enqueueSummary(queueRef.current, next);
      return;
    }
    promote(next);
  }, [contentKey, refreshVersion, trailing, animate]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  if (!animate) {
    return (
      <>
        {primary}
        {trailing}
      </>
    );
  }
  return (
    <span className="relative inline-flex min-w-0 items-center gap-2 overflow-hidden align-middle">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={displayed.key}
          className="inline-flex min-w-0 items-center gap-2"
          initial={{ y: '0.8em', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-0.8em', opacity: 0 }}
          transition={ROLL_TRANSITION}
        >
          {displayed.primary}
        </motion.span>
      </AnimatePresence>
      {displayed.trailing}
    </span>
  );
}
