import { ENSO_AGENT_TYPE_KEY } from '@shared/builtinAgents';
import { PanelLeft, Search, Settings2, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { EnsoMark } from '@/components/chat/EnsoMark';
import { useI18n } from '@/i18n';
import { effectiveKeybindings, formatBinding } from '@/lib/keybindings';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { RailTip } from './RailTip';

interface AppRailProps {
  /** 侧栏是否收起；仅在可收起的视图（Code / Bot）传入 */
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  /** Code / Bot 模式入口常驻图标轨，侧栏收起后仍可切换 */
  modeSwitch?: ReactNode;
  /** 侧栏收起时补上的搜索入口（展开时搜索在侧栏顶部） */
  onOpenSearch?: () => void;
}

const RAIL_BUTTON =
  'relative flex size-[36px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40';

/**
 * 全局图标轨（56px）：品牌、侧栏开关、收起时的搜索、分隔符、模式切换、Enso 与设置。
 * 图标不带文字，名称走右侧悬浮提示。
 */
export function AppRail({
  sidebarCollapsed,
  onToggleSidebar,
  modeSwitch,
  onOpenSearch,
}: AppRailProps) {
  const { t } = useI18n();
  const keybindings = useSettingsStore((s) => s.keybindings);
  const bindings = effectiveKeybindings(keybindings);
  const shortcut = (binding?: string) => (binding ? formatBinding(binding) : undefined);
  const sidebarLabel = sidebarCollapsed ? t('Expand sidebar') : t('Collapse sidebar');

  return (
    <nav
      data-slot="app-rail"
      aria-label="EnsoCode"
      // 固定像素宽：根字号可调（--font-size-base），图标轨不随 rem 缩放
      className="flex w-[56px] shrink-0 flex-col items-center gap-[8px] bg-shell py-[12px]"
    >
      <div className="mb-[4px] flex size-[32px] items-center justify-center text-foreground">
        <EnsoMark className="size-[24px]" />
      </div>
      {onToggleSidebar && (
        <RailTip label={sidebarLabel} shortcut={shortcut(bindings['toggle-sidebar'])}>
          <button
            type="button"
            onClick={onToggleSidebar}
            className={RAIL_BUTTON}
            aria-pressed={!sidebarCollapsed}
            aria-label={sidebarLabel}
          >
            <PanelLeft className="size-[18px]" />
          </button>
        </RailTip>
      )}
      {sidebarCollapsed && onOpenSearch && (
        <RailTip label={t('Search anything')} shortcut={shortcut(bindings['search-workspace'])}>
          <button
            type="button"
            onClick={onOpenSearch}
            className={RAIL_BUTTON}
            aria-label={t('Search anything')}
          >
            <Search className="size-[18px]" />
          </button>
        </RailTip>
      )}
      {(onToggleSidebar || modeSwitch) && (
        <div
          data-slot="app-rail-separator"
          className="my-1 w-5 border-t border-border"
          aria-hidden
        />
      )}
      {modeSwitch}
      <div className="flex-1" />
      <RailTip label={t('Ask Enso')}>
        <button
          type="button"
          onClick={() => {
            void window.electronAPI.window.summonAgent({ typeKey: ENSO_AGENT_TYPE_KEY });
          }}
          className={cn(RAIL_BUTTON, 'text-brand hover:text-brand')}
          aria-label={t('Ask Enso')}
        >
          <Sparkles className="size-[19px]" />
        </button>
      </RailTip>
      <RailTip label={t('Settings')} shortcut={shortcut(bindings['open-settings'])}>
        <button
          type="button"
          onClick={() => void window.electronAPI.window.openSettings()}
          className={RAIL_BUTTON}
          aria-label={t('Settings')}
        >
          <Settings2 className="size-[19px]" />
        </button>
      </RailTip>
    </nav>
  );
}
