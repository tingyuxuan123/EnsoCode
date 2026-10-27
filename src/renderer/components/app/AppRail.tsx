import { ENSO_AGENT_TYPE_KEY } from '@shared/builtinAgents';
import type { SettingsCategory } from '@shared/settingsDeepLink';
import {
  type LucideIcon,
  PanelLeft,
  PanelLeftClose,
  Plug,
  Search,
  Server,
  Settings,
  Sparkles,
  Zap,
} from 'lucide-react';
import { EnsoMark } from '@/components/chat/EnsoMark';
import { useI18n } from '@/i18n';
import { effectiveKeybindings, formatBinding } from '@/lib/keybindings';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';

interface AppRailProps {
  /** 侧栏是否收起；仅在可收起的视图（Code / Bot）传入 */
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  /** 全局搜索；远程节点视图不提供本机搜索时省略 */
  onOpenSearch?: () => void;
}

const RAIL_BUTTON =
  'relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** 设置窗口深链必须带行 id；`<分类>.root` 是各设置页顶部标题行的既有约定 */
const openSettingsAt = (category: SettingsCategory) =>
  void window.electronAPI.window.openSettings({ category, rowId: `${category}.root` });

/**
 * 全局图标轨（56px）：品牌标记、侧栏开关、搜索与常用设置入口。
 * 会话与项目相关操作仍在侧栏；这里只放跨视图的全局入口，不新增功能。
 */
export function AppRail({ sidebarCollapsed, onToggleSidebar, onOpenSearch }: AppRailProps) {
  const { t } = useI18n();
  const keybindings = useSettingsStore((s) => s.keybindings);
  const bindings = effectiveKeybindings(keybindings);
  const withShortcut = (label: string, binding?: string) =>
    binding ? `${label} (${formatBinding(binding)})` : label;

  const shortcuts: { icon: LucideIcon; label: string; category: SettingsCategory }[] = [
    { icon: Server, label: t('Model Providers'), category: 'providers' },
    { icon: Zap, label: t('Skills'), category: 'skills' },
    { icon: Plug, label: t('MCP Servers'), category: 'mcp' },
  ];

  return (
    <nav
      data-slot="app-rail"
      aria-label="EnsoCode"
      // 固定像素宽：根字号可调（--font-size-base），图标轨不随 rem 缩放
      className="flex w-[56px] shrink-0 flex-col items-center gap-1 bg-shell pt-1 pb-2"
    >
      <div className="mb-2 flex size-9 items-center justify-center text-foreground">
        <EnsoMark className="size-6" />
      </div>
      {onToggleSidebar && (
        <button
          type="button"
          onClick={onToggleSidebar}
          className={RAIL_BUTTON}
          aria-pressed={!sidebarCollapsed}
          title={withShortcut(
            sidebarCollapsed ? t('Expand sidebar') : t('Collapse sidebar'),
            bindings['toggle-sidebar']
          )}
        >
          {sidebarCollapsed ? (
            <PanelLeft className="size-[18px]" />
          ) : (
            <PanelLeftClose className="size-[18px]" />
          )}
        </button>
      )}
      {onOpenSearch && (
        <button
          type="button"
          onClick={onOpenSearch}
          className={RAIL_BUTTON}
          title={withShortcut(t('Search anything'), bindings['search-workspace'])}
        >
          <Search className="size-[18px]" />
        </button>
      )}
      <div className="my-1 h-px w-6 bg-border" aria-hidden />
      {shortcuts.map(({ icon: Icon, label, category }) => (
        <button
          key={category}
          type="button"
          onClick={() => openSettingsAt(category)}
          className={RAIL_BUTTON}
          title={label}
        >
          <Icon className="size-[18px]" />
        </button>
      ))}
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => {
          void window.electronAPI.window.summonAgent({ typeKey: ENSO_AGENT_TYPE_KEY });
        }}
        className={cn(RAIL_BUTTON, 'text-brand hover:text-brand')}
        title={t('Ask Enso')}
      >
        <Sparkles className="size-[18px]" />
      </button>
      <button
        type="button"
        onClick={() => void window.electronAPI.window.openSettings()}
        className={RAIL_BUTTON}
        title={withShortcut(t('Settings'), bindings['open-settings'])}
      >
        <Settings className="size-[18px]" />
      </button>
    </nav>
  );
}
