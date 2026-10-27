import { ENSO_AGENT_TYPE_KEY } from '@shared/builtinAgents';
import type { SettingsCategory } from '@shared/settingsDeepLink';
import {
  Blocks,
  FileDiff,
  FolderOpen,
  Globe,
  type LucideIcon,
  PanelLeft,
  Search,
  Server,
  Settings2,
  Sparkles,
  SquareTerminal,
} from 'lucide-react';
import { EnsoMark } from '@/components/chat/EnsoMark';
import { useI18n } from '@/i18n';
import { effectiveKeybindings, formatBinding } from '@/lib/keybindings';
import {
  addSidePanelBrowser,
  addSidePanelChanges,
  addSidePanelFiles,
  addSidePanelTerminal,
} from '@/lib/sidePanelDock';
import { cn } from '@/lib/utils';
import { useSessionsStore } from '@/stores/sessions';
import { useSettingsStore } from '@/stores/settings';

interface AppRailProps {
  /** 侧栏是否收起；仅在可收起的视图（Code / Bot）传入 */
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  /** 工作区工具（文件/改动/终端/浏览器）只在本机 Code 视图可用 */
  workspaceTools?: boolean;
  /** 侧栏收起时补上的搜索入口（展开时搜索在侧栏顶部） */
  onOpenSearch?: () => void;
}

const RAIL_BUTTON =
  'relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40';

/** 设置窗口深链必须带行 id；`<分类>.root` 是各设置页顶部标题行的既有约定 */
const openSettingsAt = (category: SettingsCategory) =>
  void window.electronAPI.window.openSettings({ category, rowId: `${category}.root` });

/**
 * 全局图标轨（56px）：品牌、侧栏开关、工作区工具（打开右侧面板对应页签）、
 * 技能/模型入口与设置。全部调用既有动作，不新增功能。
 */
export function AppRail({
  sidebarCollapsed,
  onToggleSidebar,
  workspaceTools,
  onOpenSearch,
}: AppRailProps) {
  const { t } = useI18n();
  const keybindings = useSettingsStore((s) => s.keybindings);
  const bindings = effectiveKeybindings(keybindings);
  const hasConversation = useSessionsStore((s) => Boolean(s.activeId));
  const withShortcut = (label: string, binding?: string) =>
    binding ? `${label} (${formatBinding(binding)})` : label;

  const tools: { icon: LucideIcon; label: string; run: () => void }[] = [
    { icon: FolderOpen, label: t('Files'), run: () => addSidePanelFiles({ title: t('Files') }) },
    {
      icon: FileDiff,
      label: t('Changes'),
      run: () => addSidePanelChanges({ title: t('Changes') }),
    },
    {
      icon: SquareTerminal,
      label: t('Terminal'),
      run: () => addSidePanelTerminal(),
    },
    { icon: Globe, label: t('Browser'), run: () => addSidePanelBrowser({ title: t('Browser') }) },
  ];
  const settingsLinks: { icon: LucideIcon; label: string; category: SettingsCategory }[] = [
    { icon: Blocks, label: t('Skills'), category: 'skills' },
    { icon: Server, label: t('Model Providers'), category: 'providers' },
  ];

  return (
    <nav
      data-slot="app-rail"
      aria-label="EnsoCode"
      // 固定像素宽：根字号可调（--font-size-base），图标轨不随 rem 缩放
      className="flex w-[56px] shrink-0 flex-col items-center gap-2 bg-shell pt-3 pb-3"
    >
      <div className="mb-1 flex size-8 items-center justify-center text-foreground">
        <EnsoMark className="size-[24px]" />
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
          <PanelLeft className="size-[18px]" />
        </button>
      )}
      {sidebarCollapsed && onOpenSearch && (
        <button
          type="button"
          onClick={onOpenSearch}
          className={RAIL_BUTTON}
          title={withShortcut(t('Search anything'), bindings['search-workspace'])}
        >
          <Search className="size-[18px]" />
        </button>
      )}
      <div className="my-1 w-5 border-t border-border" aria-hidden />
      {workspaceTools &&
        tools.map(({ icon: Icon, label, run }) => (
          <button
            key={label}
            type="button"
            onClick={run}
            disabled={!hasConversation}
            className={RAIL_BUTTON}
            title={label}
          >
            <Icon className="size-[19px]" />
          </button>
        ))}
      {settingsLinks.map(({ icon: Icon, label, category }) => (
        <button
          key={category}
          type="button"
          onClick={() => openSettingsAt(category)}
          className={RAIL_BUTTON}
          title={label}
        >
          <Icon className="size-[19px]" />
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
        <Sparkles className="size-[19px]" />
      </button>
      <button
        type="button"
        onClick={() => void window.electronAPI.window.openSettings()}
        className={RAIL_BUTTON}
        title={withShortcut(t('Settings'), bindings['open-settings'])}
      >
        <Settings2 className="size-[19px]" />
      </button>
    </nav>
  );
}
