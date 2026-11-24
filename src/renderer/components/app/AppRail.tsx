import { ENSO_AGENT_TYPE_KEY } from '@shared/builtinAgents';
import { PanelLeft, Search } from 'lucide-react';
import { useI18n } from '@/i18n';
import { effectiveKeybindings, formatBinding } from '@/lib/keybindings';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import {
  AskCodeKilnIcon,
  CodeWorkspaceIcon,
  DesignGalleryIcon,
  ImageStudioIcon,
  SettingsGearIcon,
} from './NavIcons';
import { RailTip } from './RailTip';
import { StatusBar } from './StatusBar';
import { UpdateRailItem } from './UpdateRailItem';

interface AppRailProps {
  /** 侧栏是否收起；仅在可收起的视图传入 */
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  /** 侧栏收起时补上的搜索入口（展开时搜索在侧栏顶部） */
  onOpenSearch?: () => void;
  /** 本机 Code 入口，排在图片工作台上方。 */
  codeWorkspace?: { active: boolean; onToggle(): void };
  /** 仅本机 Code 且设计功能开启时提供；不由图标轨推导路由。 */
  designGallery?: { label: string; active: boolean; onToggle(): void };
  imageStudio?: { active: boolean; onToggle(): void };
}

const RAIL_BUTTON =
  'relative flex size-[36px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40';
const RAIL_SELECTED = 'bg-selection text-brand hover:bg-selection hover:text-brand';

/**
 * 全局图标轨（56px）：品牌、侧栏开关、收起时的搜索、分隔符、功能模块、Enso 与设置。
 * 图标不带文字，名称走右侧悬浮提示。
 */
export function AppRail({
  sidebarCollapsed,
  onToggleSidebar,
  onOpenSearch,
  codeWorkspace,
  designGallery,
  imageStudio,
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
      className="flex w-[56px] shrink-0 flex-col items-center gap-[8px] bg-shell pt-[4px] pb-[12px]"
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
            <PanelLeft className="size-[18px]" strokeWidth={1.75} />
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
            <Search className="size-[18px]" strokeWidth={1.75} />
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
            <CodeWorkspaceIcon className="size-[19px]" />
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
            <ImageStudioIcon className="size-[19px]" active={imageStudio.active} />
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
            <DesignGalleryIcon className="size-[19px]" active={designGallery.active} />
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
          <AskCodeKilnIcon className="size-[19px]" />
        </button>
      </RailTip>
      <RailTip label={t('Settings')} shortcut={shortcut(bindings['open-settings'])}>
        <button
          type="button"
          onClick={() => void window.electronAPI.window.openSettings()}
          className={RAIL_BUTTON}
          aria-label={t('Settings')}
        >
          <SettingsGearIcon className="size-[19px]" />
        </button>
      </RailTip>
    </nav>
  );
}
