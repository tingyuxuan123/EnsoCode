import { ENSO_AGENT_TYPE_KEY } from '@shared/builtinAgents';
import { WINDOWS_CAPTION_BUTTONS_WIDTH } from '@shared/windowControls';
import { Copy, Minus, Sparkles, Square, X } from 'lucide-react';
import { useRef } from 'react';
import { useNativeWindowControls } from '@/hooks/useNativeWindowControls';
import { useWindowMaximized } from '@/hooks/useWindowMaximized';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

interface TitleBarProps {
  title?: string;
  className?: string;
  /** Optional no-drag actions; omitted props preserve the existing title bar layout. */
  actions?: React.ReactNode;
  /** Optional no-drag content shown in place of the title. */
  leading?: React.ReactNode;
  /** 只读的标题内容（不拦截拖拽）；与 leading 二选一 */
  heading?: React.ReactNode;
  /**
   * 可选的居中内容使用独立覆盖层，在 Windows 上避开原生按钮区域。
   * 它保留左侧标题；macOS 隐藏标题以免挤占系统红绿灯。
   *
   * Center optional content in an overlay that excludes native Windows controls.
   * Keep the left title except on macOS, where traffic lights take precedence.
   */
  centered?: React.ReactNode;
}

export function SummonEnsoButton({ label = true }: { label?: boolean }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => {
        void window.electronAPI.window.summonAgent({ typeKey: ENSO_AGENT_TYPE_KEY });
      }}
      aria-label={t('Ask Enso')}
      title={t('Ask Enso')}
    >
      <Sparkles className="h-3.5 w-3.5" />
      {label && <span>{t('Ask Enso')}</span>}
    </button>
  );
}
/**
 * 无边框窗口标题栏：
 * - macOS: 仅作为拖拽区域（traffic lights 由系统渲染，左侧预留空间）
 * - Windows: 给原生窗口按钮预留空间，保留系统贴靠入口
 * - Linux: 自绘最小化/最大化/关闭按钮
 *
 * Preserve native caption controls and Snap Layouts on Windows, traffic lights
 * on macOS, and renderer caption controls on Linux.
 */
export function TitleBar({ title, className, actions, leading, heading, centered }: TitleBarProps) {
  const { t } = useI18n();
  const isMac = window.electronAPI.env.platform === 'darwin';
  const isWindows = window.electronAPI.env.platform === 'win32';
  const headerRef = useRef<HTMLElement>(null);
  useNativeWindowControls(headerRef);
  const maximized = useWindowMaximized();
  const nativeControlsInset = `calc(100% - env(titlebar-area-width, calc(100% - ${WINDOWS_CAPTION_BUTTONS_WIDTH}px)))`;

  return (
    <header
      ref={headerRef}
      data-native-window-controls={isWindows || undefined}
      style={isWindows ? { paddingRight: nativeControlsInset } : undefined}
      className={cn(
        // 固定像素高度：红绿灯位置 (y:16) 按 44px 高度对齐，不随 rem 缩放
        'drag-region relative flex h-11 shrink-0 items-center bg-transparent',
        isMac ? 'pl-[84px] pr-3' : 'pl-3',
        className
      )}
    >
      {leading ? (
        <div className="no-drag flex items-center">{leading}</div>
      ) : heading ? (
        <div className="flex min-w-0 flex-1 items-center">{heading}</div>
      ) : !centered || !isMac ? (
        <span className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
          {title}
        </span>
      ) : null}

      {centered && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          style={isWindows ? { right: nativeControlsInset } : undefined}
        >
          <div className="no-drag pointer-events-auto">{centered}</div>
        </div>
      )}

      {actions && <div className="no-drag ml-auto flex items-center gap-1">{actions}</div>}

      {!isMac && !isWindows && (
        <div className={cn('no-drag flex h-full items-center', !actions && 'ml-auto')}>
          <button
            type="button"
            className="flex h-full w-12 items-center justify-center hover:bg-muted"
            onClick={() => window.electronAPI.window.minimize()}
            aria-label={t('Minimize')}
            title={t('Minimize')}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="flex h-full w-12 items-center justify-center hover:bg-muted"
            onClick={() => window.electronAPI.window.maximize()}
            aria-label={maximized ? t('Restore') : t('Maximize')}
            title={maximized ? t('Restore') : t('Maximize')}
          >
            {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            className="flex h-full w-12 items-center justify-center hover:bg-destructive hover:text-destructive-foreground"
            onClick={() => window.electronAPI.window.close()}
            aria-label={t('Close')}
            title={t('Close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </header>
  );
}
