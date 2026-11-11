import { ENSO_AGENT_TYPE_KEY } from '@shared/builtinAgents';
import {
  Columns3,
  Orbit,
  PanelLeft,
  Ruler,
  Search,
  Settings2,
  Sparkles,
  SquareTerminal,
} from 'lucide-react';
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
  /** 仅本机 Code 且设计功能开启时提供；不由图标轨推导路由。 */
  designGallery?: { label: string; active: boolean; onToggle(): void };
  /** 本机全局看板，独立于当前 Code / Bot 聊天。 */
  collaborationBoard?: { active: boolean; attention?: number; onToggle(): void };
  /** 与 Code / Bot 同级，始终可以从本机图标轨打开。 */
  superAssistant?: { active: boolean; onToggle(): void };
  onBackToCode?: () => void;
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
  designGallery,
  collaborationBoard,
  superAssistant,
  onBackToCode,
}: AppRailProps) {
  const { t } = useI18n();
  const keybindings = useSettingsStore((s) => s.keybindings);
  const bindings = effectiveKeybindings(keybindings);
  const shortcut = (binding?: string) => (binding ? formatBinding(binding) : undefined);
  const sidebarLabel = sidebarCollapsed ? t('Expand sidebar') : t('Collapse sidebar');

  return (
    <nav
      data-slot="app-rail"
      aria-label="小满"
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
      {onBackToCode && (
        <RailTip label={t('Back to Code')}>
          <button
            type="button"
            className={RAIL_BUTTON}
            aria-label={t('Back to Code')}
            onClick={onBackToCode}
          >
            <SquareTerminal className="size-[19px]" />
          </button>
        </RailTip>
      )}
      {superAssistant && (
        <RailTip label={t('Super Assistant')}>
          <button
            type="button"
            onClick={superAssistant.onToggle}
            className={cn(RAIL_BUTTON, superAssistant.active && 'bg-brand/10 text-brand')}
            aria-label={t('Super Assistant')}
            aria-pressed={superAssistant.active}
          >
            <Orbit className="size-[19px]" />
          </button>
        </RailTip>
      )}
      {designGallery && (
        <RailTip label={designGallery.label}>
          <button
            type="button"
            onClick={designGallery.onToggle}
            className={cn(RAIL_BUTTON, designGallery.active && 'bg-accent text-foreground')}
            aria-label={designGallery.label}
            aria-pressed={designGallery.active}
          >
            <Ruler className="size-[19px]" />
          </button>
        </RailTip>
      )}
      {collaborationBoard && (
        <RailTip label={t('Collaboration board')}>
          <button
            type="button"
            onClick={collaborationBoard.onToggle}
            className={cn(RAIL_BUTTON, collaborationBoard.active && 'bg-accent text-foreground')}
            aria-label={t('Collaboration board')}
            aria-description={
              collaborationBoard.attention
                ? t('{{n}} tasks need your attention', { n: collaborationBoard.attention })
                : undefined
            }
            aria-pressed={collaborationBoard.active}
          >
            <Columns3 className="size-[19px]" />
            {!!collaborationBoard.attention && (
              <span
                aria-hidden
                className="pointer-events-none absolute -top-1 -right-1 min-w-3.5 rounded-full bg-warning/20 px-0.5 text-center font-semibold text-[calc(9rem/14)] text-foreground tabular-nums"
              >
                {collaborationBoard.attention > 99 ? '99+' : collaborationBoard.attention}
              </span>
            )}
          </button>
        </RailTip>
      )}
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
