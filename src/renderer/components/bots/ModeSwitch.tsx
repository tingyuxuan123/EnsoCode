import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BotMessageSquare, SquareTerminal } from 'lucide-react';
import { type KeyboardEvent, useId, useRef } from 'react';
import { useI18n } from '@/i18n';
import { effectiveKeybindings, formatBinding } from '@/lib/keybindings';
import { springStandard } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useBotPendingCount } from '@/stores/bots';
import { type AppMode, useAppModeStore } from '@/stores/bots/mode';
import { useSettingsStore } from '@/stores/settings';
import { CountBadge } from './BotSidebar';

const OPTIONS: readonly { value: AppMode; label: string; Icon: typeof SquareTerminal }[] = [
  { value: 'code', label: 'Code', Icon: SquareTerminal },
  { value: 'bot', label: 'Bot', Icon: BotMessageSquare },
];

const ARROW_STEP: Record<string, number> = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
};

// transitions.dev 03-notification-badge：斜向滑入 + 数字弹出
const BADGE_SLIDE = { duration: 0.26, ease: [0.22, 1, 0.36, 1] } as const;
const BADGE_POP = { duration: 0.5, ease: [0.34, 1.36, 0.64, 1] } as const;
const BADGE_CLOSE = { duration: 0.18, ease: [0.4, 0, 0.2, 1] } as const;

/**
 * 主标题栏中部的紧凑工作模式分段控件 `[ >_ Code | Bot ]`；图标 + 文字，不做下拉。
 *
 * 视觉对齐上游（J3n5en/EnsoCode `src/renderer/components/bots/ModeSwitch.tsx`）：
 * 轨道只一层淡底，选中分段是一枚独立的内容区色胶囊 + 小阴影，
 * 文字用前景色；尺寸按 fork 的 rem 比例缩放，跟随界面字号。
 * 轨道取中性 secondary 而不是 muted：cloud-light 里 `--muted ≈ --background`，
 * 用 muted 会让轨道和胶囊都看不见。
 *
 * - `inactive`：画廊 / 生图 / 扩展页不是工作模式，两个分段都不标成当前选中，
 *   但点击仍然会把宿主带回对应的 Code 对话或 Bot 视图。
 * - `includeBot`：Bot 实验开关（或远程节点门控）关闭时只保留 Code，
 *   用来从画廊 / 生图回到 Code 对话，不暴露未启用的 Bot。
 */
export function ModeSwitch({
  className,
  inactive = false,
  onSelect,
  includeBot = true,
}: {
  className?: string;
  inactive?: boolean;
  /** 选中后通知宿主退出画廊 / 生图 / 扩展页等模块视图 */
  onSelect?: () => void;
  includeBot?: boolean;
}) {
  const { t } = useI18n();
  const mode = useAppModeStore((s) => s.mode);
  const setMode = useAppModeStore((s) => s.setMode);
  const pending = useBotPendingCount();
  const binding = effectiveKeybindings(useSettingsStore((s) => s.keybindings))['toggle-app-mode'];
  const shortcut = binding ? formatBinding(binding) : undefined;
  const reduceMotion = useReducedMotion() ?? false;
  const pillId = useId();
  const refs = useRef<Partial<Record<AppMode, HTMLButtonElement | null>>>({});
  const options = includeBot ? OPTIONS : OPTIONS.filter((option) => option.value === 'code');

  const onKeyDown = (event: KeyboardEvent) => {
    const step = ARROW_STEP[event.key];
    if (!step || options.length < 2) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === mode);
    const next = options[(index + step + options.length) % options.length].value;
    setMode(next);
    onSelect?.();
    refs.current[next]?.focus();
  };

  return (
    <div
      role="group"
      aria-label={t('Switch mode')}
      data-slot="mode-switch"
      onKeyDown={onKeyDown}
      className={cn(
        // 高度跟随界面字号，但不能超过标题栏固定 44px（红绿灯按 44px 对齐）
        'flex h-[calc(28rem/14)] max-h-[36px] shrink-0 rounded-[calc(8rem/14)] bg-secondary/60 p-[calc(2rem/14)]',
        className
      )}
    >
      {options.map(({ value, label, Icon }) => {
        const active = !inactive && mode === value;
        const badge = value === 'bot' && mode === 'code' && pending > 0;
        return (
          <button
            key={value}
            ref={(el) => {
              refs.current[value] = el;
            }}
            type="button"
            aria-label={label}
            aria-pressed={active}
            title={shortcut ? `${label} (${shortcut})` : label}
            data-app-mode={value}
            data-rail-view={value}
            tabIndex={inactive || mode === value ? 0 : -1}
            onClick={() => {
              setMode(value);
              onSelect?.();
            }}
            className={cn(
              'relative flex shrink-0 items-center gap-[calc(6rem/14)] rounded-[calc(6rem/14)] px-[calc(10rem/14)] font-medium text-[calc(12rem/14)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {active && (
              <motion.span
                layoutId={pillId}
                aria-hidden
                data-slot="mode-switch-selection"
                className="absolute inset-0 rounded-[calc(6rem/14)] bg-background shadow-xs"
                transition={reduceMotion ? { duration: 0 } : springStandard}
              />
            )}
            <Icon className="relative size-[calc(14rem/14)]" />
            <span className="relative">{label}</span>
            <AnimatePresence>
              {badge && (
                <motion.span
                  className="pointer-events-none absolute -top-[3px] -right-[3px]"
                  initial={reduceMotion ? false : { x: -8, y: 12 }}
                  animate={{ x: 0, y: 0 }}
                  transition={BADGE_SLIDE}
                >
                  <motion.span
                    className="block"
                    initial={reduceMotion ? false : { scale: 0, opacity: 0, filter: 'blur(2px)' }}
                    animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
                    exit={
                      reduceMotion
                        ? { opacity: 0, transition: { duration: 0 } }
                        : { scale: 0, opacity: 0, filter: 'blur(2px)', transition: BADGE_CLOSE }
                    }
                    transition={BADGE_POP}
                  >
                    <CountBadge count={pending} className="block" />
                  </motion.span>
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        );
      })}
    </div>
  );
}
