import type { ThinkingLevel } from '@shared/types/agent';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import {
  levelTrackOffset,
  showsThinkingSlider,
  THINKING_SLIDER_THUMB_PX,
} from './thinkingLevelTrack';

const THUMB = THINKING_SLIDER_THUMB_PX;

/**
 * 思考档滑杆（几何与观感对齐 ZCode 的输入框模型菜单）：
 * - 交互是一条铺满整块的原生 range：点哪档跳哪档、可拖、方向键 / Home / End 可用，
 *   aria-valuetext 报当前档名；
 * - 视觉自绘：整宽轨道 + 白色档位点 + 白滑块。此前轨道两端各内缩 14px，滑块走到
 *   末档就探出轨道半截，像"滑脱了"，所以轨道改成占满整宽；
 * - 滑块圆心、填充端点、档位点、文字标签全部来自 levelTrackOffset 同一套落点：
 *   标签永远对着滑块，而不是差半个字宽；
 * - 只有一个可用档时不画滑杆（没有可调范围，禁用态只会让人以为坏了）。
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

  const offsetOf = (target: number): string => levelTrackOffset(target, levels.length);
  const labelOf = (value: ThinkingLevel): string => t(labels[value]);

  return (
    <div className="mt-3" data-thinking-slider={current}>
      <div className="relative h-[28px] rounded-full has-focus-visible:ring-2 has-focus-visible:ring-ring/40">
        {/* 交互层：原生 range 铺满整块，视觉层 pointer-events-none，命中全部交给它。
            ::-*-thumb 的 28px 必须等于 THINKING_SLIDER_THUMB_PX：原生滑块的落点决定
            点击/拖拽的换算，尺寸不一致就会出现"点这档、跳到隔壁档"。 */}
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
          className="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none bg-transparent outline-none [&::-moz-range-progress]:bg-transparent [&::-moz-range-thumb]:size-[28px] [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent [&::-moz-range-track]:h-[28px] [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-[28px] [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:size-[28px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-transparent"
        />
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {/* 轨道：整宽圆角 + 极淡描边；滑块滑到末档正好压在轨道圆头上，不再探出去 */}
          <div className="absolute inset-x-0 top-[2px] h-[24px] overflow-hidden rounded-full bg-foreground/[0.08] ring-1 ring-foreground/[0.06] ring-inset">
            <div
              className="absolute inset-y-0 left-0 overflow-hidden rounded-full bg-primary transition-[width] duration-150 ease-out motion-reduce:transition-none"
              // 填充端点就是滑块圆心（同一条几何表达式），滑块压在上面，视觉上是一整条
              style={{ width: offsetOf(index) }}
            >
              {/* 顶档给一点色彩位移，让"已经拉满"有明确终点；渐变层常驻只切透明度，反向调档不会瞬切 */}
              <div
                data-max={index === levels.length - 1}
                className="absolute inset-0 bg-[linear-gradient(90deg,var(--color-primary),var(--color-violet-400))] opacity-0 transition-opacity duration-300 ease-out data-[max=true]:opacity-100 motion-reduce:transition-none"
              />
            </div>
          </div>
          {levels.map((entry, dotIndex) => (
            <span
              key={entry}
              style={{ left: offsetOf(dotIndex) }}
              className={cn(
                'absolute top-[12px] size-[4px] -translate-x-1/2 rounded-full transition-colors duration-150',
                dotIndex <= index ? 'bg-white/50' : 'bg-foreground/30'
              )}
            />
          ))}
          <div
            style={{ left: offsetOf(index), width: THUMB, height: THUMB }}
            className="absolute top-0 -translate-x-1/2 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.28)] ring-1 ring-black/10 transition-[left] duration-150 ease-out motion-reduce:transition-none"
          />
        </div>
      </div>
      {/* 标签层：与档位点同一套落点；首末档靠边对齐收进面板，点击标签也能直接落档 */}
      <div className="relative mt-1.5 h-4">
        {levels.map((entry, labelIndex) => {
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
              style={{ left: offsetOf(labelIndex) }}
              className={cn(
                'absolute top-0 whitespace-nowrap text-[11px] leading-4 transition-colors',
                labelIndex === 0
                  ? 'text-left'
                  : labelIndex === levels.length - 1
                    ? '-translate-x-full text-right'
                    : '-translate-x-1/2 text-center',
                active
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {labelOf(entry)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
