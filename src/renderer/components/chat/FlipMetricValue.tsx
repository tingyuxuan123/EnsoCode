import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';

const FLIP_TRANSITION = { duration: 0.16, ease: [0.4, 0, 0.2, 1] } as const;

const isDigit = (character: string): boolean => /^[0-9]$/.test(character);

function widthClass(character: string): string {
  if (isDigit(character)) return 'w-[0.66em]';
  if (character === ':' || character === '.') return 'w-[0.34em]';
  return 'w-[0.7em]';
}

/**
 * 每个字符一个固定宽度的槽：数字变化时只在自己的槽里翻页，相邻字符不跟着抖。
 * 非数字字符与减少动态效果时静态显示。
 */
function MetricCharacter({
  character,
  index,
  animate,
  animateInitial,
}: {
  character: string;
  index: number;
  animate: boolean;
  animateInitial: boolean;
}) {
  const slot = cn(
    'inline-flex h-[1.15em] shrink-0 items-center justify-center leading-none',
    widthClass(character)
  );
  if (!isDigit(character) || !animate) {
    return (
      <span aria-hidden="true" className={slot}>
        {character}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={cn(slot, 'relative overflow-hidden [perspective:8em]')}>
      <AnimatePresence initial={animateInitial}>
        <motion.span
          key={`${index}-${character}`}
          className="absolute inset-0 flex items-center justify-center leading-none"
          initial={{ rotateX: -90, y: '-0.45em', opacity: 0 }}
          animate={{ rotateX: 0, y: 0, opacity: 1 }}
          exit={{ rotateX: 90, y: '0.45em', opacity: 0 }}
          style={{ transformOrigin: '50% 50%' }}
          transition={FLIP_TRANSITION}
        >
          {character}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** 数字翻页（对齐 ZCode FlipMetricValue） */
export function FlipMetricValue({
  value,
  className,
  animateInitial = false,
}: {
  value: string;
  className?: string;
  animateInitial?: boolean;
}) {
  const reducedMotion = useReducedMotion() === true;
  const characters = useMemo(() => Array.from(value), [value]);
  return (
    <span
      role="img"
      aria-label={value}
      title={value}
      className={cn(
        'inline-flex max-w-full items-center overflow-hidden whitespace-nowrap align-middle leading-none',
        className
      )}
    >
      {characters.map((character, index) => (
        <MetricCharacter
          // biome-ignore lint/suspicious/noArrayIndexKey: 槽位按下标固定，字符变化只在槽内翻页
          key={index}
          character={character}
          index={index}
          animate={!reducedMotion}
          animateInitial={animateInitial}
        />
      ))}
    </span>
  );
}

/** 改动行数：绿色 +N / 红色 -N，数字翻页；两者都为 0 时不渲染 */
export function DiffCount({
  added,
  removed,
  animateInitial,
}: {
  added: number;
  removed: number;
  animateInitial?: boolean;
}) {
  if (added <= 0 && removed <= 0) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[12px] leading-none tabular-nums">
      {added > 0 && (
        <span className="inline-flex items-center text-emerald-600 dark:text-emerald-400">
          +<FlipMetricValue value={String(added)} animateInitial={animateInitial} />
        </span>
      )}
      {removed > 0 && (
        <span className="inline-flex items-center text-red-600 dark:text-red-400">
          -<FlipMetricValue value={String(removed)} animateInitial={animateInitial} />
        </span>
      )}
    </span>
  );
}
