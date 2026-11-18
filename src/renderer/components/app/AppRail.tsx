import { ENSO_AGENT_TYPE_KEY } from '@shared/builtinAgents';
import {
  Image,
  PanelLeft,
  Ruler,
  Search,
  Settings2,
  Sparkles,
  SquareKanban,
  SquareTerminal,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { effectiveKeybindings, formatBinding } from '@/lib/keybindings';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { RailTip } from './RailTip';
import { StatusBar } from './StatusBar';
import { UpdateRailItem } from './UpdateRailItem';

interface AppRailProps {
  /** 侧栏是否收起；仅在可收起的视图（Code / Bot）传入 */
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  /** 侧栏收起时补上的搜索入口（展开时搜索在侧栏顶部） */
  onOpenSearch?: () => void;
  /**
   * Bot 功能关闭时由宿主提供：标题栏不再渲染只剩 Code 一项的分段控件，
   * Code 入口回到图标轨，排在图片工作台上方。
   */
  codeWorkspace?: { active: boolean; onToggle(): void };
  /** 仅本机 Code 且设计功能开启时提供；不由图标轨推导路由。 */
  designGallery?: { label: string; active: boolean; onToggle(): void };
  imageStudio?: { active: boolean; onToggle(): void };
  /** 本机全局看板，独立于当前 Code / Bot 聊天。 */
  collaborationBoard?: { active: boolean; attention?: number; onToggle(): void };
}

const RAIL_BUTTON =
  'relative flex size-[36px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40';
const RAIL_SELECTED = 'bg-selection text-brand hover:bg-selection hover:text-brand';

/**
 * 全局图标轨（56px）：品牌、侧栏开关、收起时的搜索、分隔符、功能模块、Enso 与设置。
 * Code / Bot 是工作模式，入口默认在主标题栏中部；Bot 功能关闭时标题栏只剩一个
 * Code 分段没有意义，改由宿主传入 `codeWorkspace`，把 Code 入口放回图片工作台上方。
 * 图标不带文字，名称走右侧悬浮提示。
 */
export function AppRail({
  sidebarCollapsed,
  onToggleSidebar,
  onOpenSearch,
  codeWorkspace,
  designGallery,
  imageStudio,
  collaborationBoard,
}: AppRailProps) {
  const { t } = useI18n();
  const keybindings = useSettingsStore((s) => s.keybindings);
  const bindings = effectiveKeybindings(keybindings);
  const shortcut = (binding?: string) => (binding ? formatBinding(binding) : undefined);
  const sidebarLabel = sidebarCollapsed ? t('Expand sidebar') : t('Collapse sidebar');

  return (
    <nav
      data-slot="app-rail"
      aria-label="CodeKiln"
      // 固定像素宽：根字号可调（--font-size-base），图标轨不随 rem 缩放
      className="flex w-[56px] shrink-0 flex-col items-center gap-[8px] bg-shell py-[12px]"
    >
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
      {onToggleSidebar && (
        <div
          data-slot="app-rail-separator"
          className="my-1 w-5 border-t border-border"
          aria-hidden
        />
      )}
      {codeWorkspace && (
        <RailTip label="Code">
          <button
            type="button"
            onClick={codeWorkspace.onToggle}
            className={cn(RAIL_BUTTON, codeWorkspace.active && RAIL_SELECTED)}
            aria-label="Code"
            data-rail-view="code"
            aria-pressed={codeWorkspace.active}
          >
            <SquareTerminal className="size-[19px]" />
          </button>
        </RailTip>
      )}
      {imageStudio && (
        <RailTip label={t('Image studio')}>
          <button
            type="button"
            onClick={imageStudio.onToggle}
            className={cn(RAIL_BUTTON, imageStudio.active && RAIL_SELECTED)}
            aria-label={t('Image studio')}
            data-rail-view="images"
            aria-pressed={imageStudio.active}
          >
            <Image className="size-[19px]" />
          </button>
        </RailTip>
      )}
      {designGallery && (
        <RailTip label={designGallery.label}>
          <button
            type="button"
            onClick={designGallery.onToggle}
            className={cn(RAIL_BUTTON, designGallery.active && RAIL_SELECTED)}
            aria-label={designGallery.label}
            data-rail-view="design"
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
            className={cn(RAIL_BUTTON, collaborationBoard.active && RAIL_SELECTED)}
            aria-label={t('Collaboration board')}
            data-rail-view="board"
            aria-description={
              collaborationBoard.attention
                ? t('{{n}} tasks need your attention', { n: collaborationBoard.attention })
                : undefined
            }
            aria-pressed={collaborationBoard.active}
          >
            <SquareKanban className="size-[19px]" />
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
      <UpdateRailItem />
      <StatusBar />
      <RailTip label={t('Ask CodeKiln')}>
        <button
          type="button"
          onClick={() => {
            void window.electronAPI.window.summonAgent({ typeKey: ENSO_AGENT_TYPE_KEY });
          }}
          className={cn(RAIL_BUTTON, 'text-brand hover:text-brand')}
          aria-label={t('Ask CodeKiln')}
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
