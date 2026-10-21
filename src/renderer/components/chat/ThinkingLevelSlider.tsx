import type { ThinkingLevel } from '@shared/types/agent';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { levelFillPercent, levelRatios, showsThinkingSlider } from './thinkingLevelTrack';

/**
 * 思考档滑杆（对齐 ZCode 的交互与观感）：
 * - 交互用原生 range 铺满整条：点哪档就跳哪档、可拖、方向键/Home/End 可用，
 *   不用禁用态把焦点挪走（目录异步刷新时仍保留焦点）；
 * - 视觉自绘：加粗轨道 + 每档一个圆点 + 一个白色大滑块，当前档一眼可读；
 * - 首末档内缩半个滑块，圆点与文字标签才对得上实际落点。
 */
export function ThinkingLevelSlider({
  levels,
  level,
  labels,
  ariaLabel,
  onChange,
}: {
  levels: readonly ThinkingLevel[];
  level: ThinkingLevel;
  labels: Record<ThinkingLevel, string>;
  ariaLabel: string;
  onChange: (level: ThinkingLevel) => void;
}) {
  const { t } = useI18n();
  const index = Math.max(0, levels.indexOf(level));
  const current = levels[index] ?? levels[0];
  if (!current || !showsThinkingSlider(levels.length)) return null;

  const ratios = levelRatios(levels.length);
  const fill = levelFillPercent(index, levels.length);
  const labelOf = (value: ThinkingLevel): string => t(labels[value]);

  return (
    <div className="mt-2">
      <div
        className="relative h-8 rounded-full has-focus-visible:ring-[3px] has-focus-visible:ring-ring/24"
        data-thinking-slider={current}
      >
        {/* 视觉层：轨道 + 填充 + 档位点 + 滑块。全部 pointer-events-none，命中交给上面的 range */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-3.5 top-1 h-6 overflow-hidden rounded-full bg-input">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-150 ease-out"
              style={{ width: `calc(14px + (100% - 28px) * ${fill / 100})` }}
            />
          </div>
          <div className="absolute inset-x-3.5 inset-y-0 flex items-center justify-between">
            {ratios.map((ratio, dotIndex) => (
              <span
                key={`${ratio}-${levels[dotIndex]}`}
                className={cn(
                  'size-1 rounded-full',
                  dotIndex <= index ? 'bg-primary-foreground/70' : 'bg-muted-foreground/50'
                )}
              />
            ))}
          </div>
          <div
            className="absolute top-0.5 size-7 rounded-full border border-border bg-white shadow-sm transition-[left] duration-150 ease-out motion-reduce:transition-none"
            style={{ left: `calc((100% - 28px) * ${fill / 100})` }}
          />
        </div>
        <input
          type="range"
          aria-label={ariaLabel}
          aria-valuetext={labelOf(current)}
          min={0}
          max={Math.max(0, levels.length - 1)}
          step={1}
          value={index}
          onChange={(event) => {
            const next = levels[Number(event.currentTarget.value)];
            if (next && next !== level) onChange(next);
          }}
          onKeyDown={(event) => {
            // 方向键归滑杆：不拦住的话冒泡到 Menu，焦点会被菜单项抢走（ZCode 同款处理）。
            // Escape 照常放行——它是关菜单的通用手势。
            if (event.key === 'Escape') return;
            event.stopPropagation();
          }}
          className="absolute inset-0 m-0 h-8 w-full cursor-pointer appearance-none bg-transparent outline-none [&::-moz-range-thumb]:size-7 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent [&::-moz-range-track]:h-8 [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-8 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:size-7 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-transparent"
        />
      </div>
      {/* 标签层：与档位点同一套内缩几何；点击标签也能直接落档 */}
      <div className="relative mt-1 h-5">
        {ratios.map((ratio, labelIndex) => {
          const entry = levels[labelIndex];
          if (!entry) return null;
          const active = labelIndex === index;
          return (
            <button
              key={entry}
              type="button"
              tabIndex={-1}
              data-thinking-tick={entry}
              onClick={() => {
                if (!active) onChange(entry);
              }}
              className="absolute top-0 flex w-0 flex-col items-center"
              style={{
                left: `calc(14px + (100% - 28px) * ${ratio})`,
                transform:
                  labelIndex === 0
                    ? 'none'
                    : labelIndex === levels.length - 1
                      ? 'translateX(-100%)'
                      : 'translateX(-50%)',
              }}
            >
              <span className="h-1.5 w-px shrink-0 bg-muted-foreground/40" />
              <span
                className={cn(
                  'mt-0.5 whitespace-nowrap text-[10px] transition-colors',
                  active
                    ? 'font-medium text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {labelOf(entry)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
