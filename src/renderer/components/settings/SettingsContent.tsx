import type { SettingsDeepLink } from '@shared/settingsDeepLink';
import {
  BarChart3,
  Bot,
  FileText,
  Gauge,
  Keyboard,
  Layers,
  Mic,
  Palette,
  Plug,
  Puzzle,
  Server,
  Smartphone,
  Sparkles,
  Terminal,
  Workflow,
  Wrench,
} from 'lucide-react';
import * as React from 'react';
import { GeneralPreferencesIcon } from '@/components/app/NavIcons';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { AgentTypesSettings } from './AgentTypesSettings';
import { AppearanceSettings } from './AppearanceSettings';
import { BuiltinToolsSettings } from './BuiltinToolsSettings';
import type { SettingsCategory } from './constants';
import { DevicesSettings } from './DevicesSettings';
import { GeneralSettings } from './GeneralSettings';
import { InstructionsSettings } from './InstructionsSettings';
import { KeybindingsSettings } from './KeybindingsSettings';
import { McpSettings } from './McpSettings';
import { PluginsSettings } from './PluginsSettings';
import { PresetsSettings } from './PresetsSettings';
import { ProvidersSettings } from './ProvidersSettings';
import { ResourcesSettings } from './ResourcesSettings';
import { SkillsSettings } from './SkillsSettings';
import { SshSettings } from './SshSettings';
import { resolveActiveCategory, visibleCategories } from './settingsCategories';
import { UsageSettings } from './UsageSettings';
import { VoiceInputSettings } from './VoiceInputSettings';
import { WorkflowsSettings } from './WorkflowsSettings';

function flashSettingsRow(rowId: string): void {
  window.requestAnimationFrame(() => {
    const el = document.querySelector(`[data-settings-row="${CSS.escape(rowId)}"]`);
    if (!(el instanceof HTMLElement)) return;
    el.scrollIntoView({ block: 'center' });
    el.dataset.settingsFlash = 'true';
    window.setTimeout(() => {
      delete el.dataset.settingsFlash;
    }, 1600);
  });
}

export function SettingsContent() {
  const { t } = useI18n();
  const [activeCategory, setActiveCategory] = React.useState<SettingsCategory>('general');
  const [flashRowId, setFlashRowId] = React.useState<string | null>(null);
  const disabledBuiltinTools = useSettingsStore((state) => state.disabledBuiltinTools);

  const applyLink = React.useCallback((link: SettingsDeepLink) => {
    setActiveCategory(link.category);
    setFlashRowId(link.rowId);
  }, []);

  React.useEffect(() => {
    void window.electronAPI.window.consumeSettingsDeepLink().then((link) => {
      if (link) applyLink(link);
    });
    return window.electronAPI.window.onSettingsDeepLink(applyLink);
  }, [applyLink]);

  React.useLayoutEffect(() => {
    if (!flashRowId) return;
    flashSettingsRow(flashRowId);
    const timer = window.setTimeout(() => setFlashRowId(null), 1600);
    return () => window.clearTimeout(timer);
  }, [flashRowId]);

  const allCategories: Array<{
    id: SettingsCategory;
    icon: React.ElementType;
    label: string;
  }> = [
    { id: 'general', icon: GeneralPreferencesIcon, label: t('General') },
    { id: 'shortcuts', icon: Keyboard, label: t('Shortcuts') },
    { id: 'voice', icon: Mic, label: t('Voice input') },
    { id: 'appearance', icon: Palette, label: t('Appearance') },
    { id: 'providers', icon: Server, label: t('Model Providers') },
    { id: 'presets', icon: Layers, label: t('Presets') },
    { id: 'agents', icon: Bot, label: t('Agent types') },
    { id: 'tools', icon: Wrench, label: t('Built-in tools') },
    { id: 'workflows', icon: Workflow, label: t('Workflows') },
    { id: 'skills', icon: Sparkles, label: t('Skills') },
    { id: 'plugins', icon: Puzzle, label: t('Claude Code plugins') },
    { id: 'mcp', icon: Plug, label: t('MCP Servers') },
    { id: 'instructions', icon: FileText, label: t('Instruction Files') },
    { id: 'phone', icon: Smartphone, label: t('Devices') },
    { id: 'ssh', icon: Terminal, label: t('SSH') },
    { id: 'usage', icon: BarChart3, label: t('Usage') },
    { id: 'resources', icon: Gauge, label: t('Resources') },
  ];
  const categories = visibleCategories(allCategories, disabledBuiltinTools);

  // 当前页随功能开关隐藏时，落到能重新启用该功能的地方。
  const resolvedCategory = resolveActiveCategory(activeCategory, disabledBuiltinTools);
  React.useEffect(() => {
    if (resolvedCategory !== activeCategory) setActiveCategory(resolvedCategory);
  }, [resolvedCategory, activeCategory]);

  return (
    <div className="flex h-full w-full border-t border-line" data-slot="settings-content">
      {/* Left: Category List */}
      <nav
        aria-label={t('Settings')}
        className="w-[240px] shrink-0 space-y-[2px] overflow-y-auto border-r border-line bg-nav p-[8px] max-sm:w-[184px]"
        data-slot="settings-navigation"
      >
        {categories.map((category) => (
          <button
            type="button"
            key={category.id}
            onClick={() => setActiveCategory(category.id)}
            aria-current={activeCategory === category.id ? 'page' : undefined}
            className={cn(
              'flex min-h-[calc(32rem/14)] w-full items-center gap-[8px] rounded-[6px] px-[10px] py-[6px] text-left text-[calc(13rem/14)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-nav',

              activeCategory === category.id
                ? 'bg-selection font-medium text-selection-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            <category.icon className="size-[calc(16rem/14)] shrink-0" />
            <span className="truncate">{category.label}</span>
          </button>
        ))}
      </nav>

      {/* Right: Settings Panel */}
      <div
        className="min-w-0 flex-1 overflow-y-auto bg-panel px-[40px] py-[32px] max-sm:px-[24px]"
        data-slot="settings-panel"
      >
        {activeCategory === 'general' && <GeneralSettings />}
        {activeCategory === 'shortcuts' && <KeybindingsSettings />}
        {activeCategory === 'appearance' && <AppearanceSettings />}
        {activeCategory === 'providers' && <ProvidersSettings />}
        {activeCategory === 'skills' && <SkillsSettings />}
        {activeCategory === 'plugins' && <PluginsSettings />}
        {activeCategory === 'mcp' && <McpSettings />}
        {activeCategory === 'instructions' && <InstructionsSettings />}
        {activeCategory === 'presets' && <PresetsSettings />}
        {activeCategory === 'agents' && <AgentTypesSettings />}
        {activeCategory === 'workflows' && <WorkflowsSettings />}
        {activeCategory === 'tools' && <BuiltinToolsSettings />}
        {activeCategory === 'phone' && <DevicesSettings />}
        {activeCategory === 'ssh' && <SshSettings />}
        {activeCategory === 'usage' && <UsageSettings />}
        {activeCategory === 'resources' && <ResourcesSettings />}
        {activeCategory === 'voice' && <VoiceInputSettings />}
      </div>
    </div>
  );
}
