import { MoreHorizontal } from 'lucide-react';
import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover';
import { useI18n } from '@/i18n';
import { pickToolbarCollapse } from './toolbarCollapse';

export interface CollapsingToolbarItem {
  id: string;
  /** 收起优先级：越小越先收成图标、越先进「…」 */
  rank: number;
  render: (compact: boolean) => ReactNode;
}

const GAP = 4;
const MORE_WIDTH = 28;
/** 尚未测量过的状态用估计值，测到真实宽度后再收敛 */
const COMPACT_ESTIMATE = 30;
const LABEL_ESTIMATE = 72;

/**
 * composer 工具行里可收起的一组控件：宽度不够时按 rank 一个一个收成图标，
 * 全是图标还放不下再一个一个收进「…」，点开在弹层里按完整样式操作。
 */
export function CollapsingToolbar({ items }: { items: CollapsingToolbarItem[] }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const widths = useRef(new Map<string, number>());
  const [available, setAvailable] = useState(Number.NaN);
  const [version, setVersion] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);

  const ranked = useMemo(() => [...items].sort((a, b) => a.rank - b.rank), [items]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version 标记 widths（ref）已更新
  const decision = useMemo(
    () =>
      pickToolbarCollapse(
        ranked.map((item) => {
          const compact = widths.current.get(`${item.id}:compact`) ?? COMPACT_ESTIMATE;
          return {
            compact,
            full: widths.current.get(`${item.id}:full`) ?? compact + LABEL_ESTIMATE,
          };
        }),
        available,
        { gap: GAP, moreWidth: MORE_WIDTH }
      ),
    [ranked, available, version]
  );
  const compactIds = new Set(ranked.slice(0, decision.compact).map((item) => item.id));
  const overflowIds = new Set(ranked.slice(0, decision.overflow).map((item) => item.id));
  const overflowed = items.filter((item) => overflowIds.has(item.id));

  const observer = useRef<ResizeObserver | null>(null);
  const record = useCallback((target: Element) => {
    const id = (target as HTMLElement).dataset.toolbarItem;
    if (!id) {
      const next = target.getBoundingClientRect().width;
      setAvailable((previous) => (Math.abs(previous - next) < 0.5 ? previous : next));
      return;
    }
    const key = `${id}:${(target as HTMLElement).dataset.compact === 'true' ? 'compact' : 'full'}`;
    const width = target.getBoundingClientRect().width;
    if (width <= 0 || Math.abs((widths.current.get(key) ?? -1) - width) < 0.5) return;
    widths.current.set(key, width);
    setVersion((value) => value + 1);
  }, []);

  useLayoutEffect(() => {
    const resize = new ResizeObserver((entries) => {
      for (const entry of entries) record(entry.target);
    });
    observer.current = resize;
    const container = containerRef.current;
    if (container) {
      resize.observe(container);
      for (const child of container.querySelectorAll('[data-toolbar-item]')) {
        resize.observe(child);
      }
    }
    return () => {
      resize.disconnect();
      observer.current = null;
    };
  }, [record]);

  const itemRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      observer.current?.observe(node);
      record(node);
    },
    [record]
  );

  return (
    <div
      ref={containerRef}
      className="flex min-w-0 flex-1 items-center gap-[4px]"
      data-slot="composer-toolbar-items"
    >
      {items.map((item) => {
        if (overflowIds.has(item.id)) return null;
        const compact = compactIds.has(item.id);
        return (
          <div
            key={item.id}
            ref={itemRef}
            className="flex shrink-0"
            data-toolbar-item={item.id}
            data-compact={compact}
          >
            {item.render(compact)}
          </div>
        );
      })}
      {overflowed.length > 0 && (
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger
            className="flex size-[calc(28rem/14)] shrink-0 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('More actions')}
            title={t('More actions')}
            data-slot="composer-toolbar-more"
          >
            <MoreHorizontal className="size-[calc(14rem/14)]" />
          </PopoverTrigger>
          <PopoverPopup side="top" align="start" className="[&_[data-slot=popover-viewport]]:p-1">
            <div
              className="flex flex-col items-start gap-[2px]"
              data-slot="composer-toolbar-overflow"
            >
              {overflowed.map((item) => (
                <div key={item.id} className="flex">
                  {item.render(false)}
                </div>
              ))}
            </div>
          </PopoverPopup>
        </Popover>
      )}
    </div>
  );
}
