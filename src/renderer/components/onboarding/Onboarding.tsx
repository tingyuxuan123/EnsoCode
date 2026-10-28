import { ENSO_AGENT_TYPE_KEY } from '@shared/builtinAgents';
import { resolveChatModel } from '@shared/defaultModel';
import { Bot, Check, Layers, Plug, Server, Sparkles, Wand2, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useOverlayGuard } from '@/hooks/useOverlayGuard';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useMaterializedProviders } from '@/stores/modelDirectory/useProviders';
import { oauthCredentialContext, useOauthCredentialStore } from '@/stores/oauthCredentials';
import { useSettingsStore } from '@/stores/settings';
import { AgentTypeList } from '../settings/AgentTypesSettings';
import { LocalAssetImportDialog } from '../settings/LocalAssetImportDialog';
import { LocalImportDialog } from '../settings/LocalImportDialog';
import { PresetEditDialog } from '../settings/PresetsSettings';
import { ProviderSetupWizard } from '../settings/ProviderSetupWizard';

type StepId =
  | 'welcome'
  | 'provider'
  | 'skill'
  | 'mcp'
  | 'instruction'
  | 'preset'
  | 'agentType'
  | 'done';
const STEPS: StepId[] = [
  'welcome',
  'provider',
  'skill',
  'mcp',
  'instruction',
  'preset',
  'agentType',
  'done',
];

/** 首次运行引导：欢迎 → 四类导入 → 完成；每步可跳过，随时可关闭 */
export function Onboarding() {
  const { t } = useI18n();
  useOverlayGuard();
  const setOnboarded = useSettingsStore((s) => s.setOnboarded);
  const providers = useMaterializedProviders();
  const virtualModels = useSettingsStore((s) => s.virtualModels);
  const skills = useSettingsStore((s) => s.skills);
  const mcpServers = useSettingsStore((s) => s.mcpServers);
  const instructions = useSettingsStore((s) => s.instructions);
  const presets = useSettingsStore((s) => s.presets);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const oauthSnapshot = useOauthCredentialStore((s) => s.snapshot);
  // 「询问 Enso」会关掉引导并召唤 Enso，而 Enso 自己也要模型才能干活——
  // 模型就绪前展示这个入口只会把用户引到死胡同（发不出消息且引导已被关）。
  // 口径与 ChatView 一致：resolveChatModel 含默认模型/provider 启用/凭证三重判定。
  const modelReady =
    resolveChatModel({
      defaultModel,
      providers,
      credentials: oauthCredentialContext(oauthSnapshot),
      virtualModels,
    }).source !== 'none';

  const [stepIndex, setStepIndex] = React.useState(0);
  const [importKind, setImportKind] = React.useState<'skill' | 'mcp' | 'instruction' | null>(null);
  const [providerOpen, setProviderOpen] = React.useState(false);
  const [setupOpen, setSetupOpen] = React.useState(false);
  const [presetOpen, setPresetOpen] = React.useState(false);
  const step = STEPS[stepIndex];

  const finish = () => setOnboarded(true);
  const summonEnso = () => {
    finish();
    void window.electronAPI.window.summonAgent({ typeKey: ENSO_AGENT_TYPE_KEY });
  };
  const next = () => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
  const prev = () => setStepIndex((i) => Math.max(0, i - 1));

  const importStep: Record<
    'provider' | 'skill' | 'mcp' | 'instruction',
    {
      icon: React.ElementType;
      title: string;
      desc: string;
      count: number;
      onImport: () => void;
      importLabel: string;
      /** 可选的第二入口，目前只有 provider 步骤用：订阅登录与本地导入并列 */
      secondary?: { label: string; onClick: () => void };
    }
  > = {
    provider: {
      icon: Server,
      title: t('Model Providers'),
      desc: t('Add a provider subscription or API Key, or import providers from local AI apps'),
      count: providers.length,
      onImport: () => setSetupOpen(true),
      importLabel: t('Add model or provider'),
      secondary: { label: t('Import from local apps'), onClick: () => setProviderOpen(true) },
    },
    skill: {
      icon: Sparkles,
      title: t('Skills'),
      desc: t('Import skills from Claude Code, Codex or Cursor'),
      count: skills.length,
      onImport: () => setImportKind('skill'),
      importLabel: t('Scan and import'),
    },
    mcp: {
      icon: Plug,
      title: t('MCP Servers'),
      desc: t('Import MCP servers configured in local AI apps'),
      count: mcpServers.length,
      onImport: () => setImportKind('mcp'),
      importLabel: t('Scan and import'),
    },
    instruction: {
      icon: Layers,
      title: t('Instruction Files'),
      desc: t('Import global instruction files configured in local AI tools'),
      count: instructions.length,
      onImport: () => setImportKind('instruction'),
      importLabel: t('Scan and import'),
    },
  };

  return (
    <div
      className="fixed inset-0 z-[45] flex items-center justify-center bg-shell px-[24px]"
      data-enso-float=""
      data-slot="onboarding"
    >
      <div className="relative flex w-[620px] max-w-full flex-col overflow-hidden rounded-[6px] border border-border bg-popover">
        <button
          type="button"
          onClick={finish}
          className="absolute right-[12px] top-[8px] flex size-[calc(24rem/14)] items-center justify-center rounded-[6px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('Close')}
        >
          <X className="h-4 w-4" />
        </button>

        {/* 进度点 */}
        <div className="flex items-center gap-[6px] border-b border-line px-[16px] py-[12px] pr-[48px]">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={cn(
                'h-[calc(4rem/14)] flex-1 rounded-full transition-colors',
                i <= stepIndex ? 'bg-primary' : 'bg-muted'
              )}
            />
          ))}
          <span className="ml-[8px] shrink-0 text-[calc(11rem/14)] tabular-nums text-muted-foreground">
            {stepIndex + 1}/{STEPS.length}
          </span>
        </div>

        <div
          className="max-h-[65vh] min-h-[calc(240rem/14)] overflow-y-auto px-[24px] py-[24px]"
          data-slot="onboarding-step"
        >
          {step === 'welcome' && (
            <div className="flex flex-col items-start gap-[8px]">
              <div className="flex items-center gap-[8px]">
                <Wand2 className="size-[calc(20rem/14)] text-primary" />
                <h2 className="text-[calc(18rem/14)] font-semibold leading-[calc(26rem/14)]">
                  {t('Welcome to EnsoCode')}
                </h2>
              </div>
              <p className="text-[calc(13rem/14)] leading-[calc(24rem/14)] text-muted-foreground">
                {t(
                  'Import your providers and assets from local AI apps to get started. You can skip any step.'
                )}
              </p>
            </div>
          )}

          {step !== 'welcome' && step !== 'done' && step !== 'preset' && step !== 'agentType' && (
            <ImportStepView
              {...importStep[step]}
              importedLabel={t('{{count}} imported', { count: importStep[step].count })}
            />
          )}

          {step === 'preset' && (
            <ImportStepView
              icon={Layers}
              title={t('Presets')}
              desc={t(
                'Bundle skills, MCP servers and an instruction file into a preset (optional)'
              )}
              count={presets.length}
              onImport={() => setPresetOpen(true)}
              importedLabel={t('{{count}} presets', { count: presets.length })}
              importLabel={t('New preset')}
            />
          )}

          {step === 'agentType' && (
            <div className="flex flex-col gap-[16px]">
              <div className="space-y-[6px]">
                <div className="flex items-center gap-[8px]">
                  <Bot className="size-[calc(20rem/14)] text-primary" />
                  <h2 className="text-[calc(18rem/14)] font-semibold leading-[calc(26rem/14)]">
                    {t('Agent types')}
                  </h2>
                </div>
                <p className="text-[calc(13rem/14)] leading-[calc(24rem/14)] text-muted-foreground">
                  {t('Give subagents their own model, skills and MCP servers (optional)')}
                </p>
              </div>
              <div className="max-h-64 overflow-y-auto pr-1">
                <AgentTypeList />
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center gap-[8px] py-[24px] text-center">
              <div className="flex size-[calc(32rem/14)] items-center justify-center rounded-full bg-success/10">
                <Check className="size-[calc(24rem/14)] text-success" />
              </div>
              <h2 className="text-[calc(18rem/14)] font-semibold leading-[calc(26rem/14)]">
                {t('All set')}
              </h2>
              <p className="text-[calc(13rem/14)] leading-[calc(24rem/14)] text-muted-foreground">
                {t('You can always import more from Settings later.')}
              </p>
            </div>
          )}

          {modelReady && (
            <div className="mt-[16px] flex items-center justify-between gap-[12px] rounded-[6px] border border-line px-[12px] py-[8px]">
              <p className="text-[calc(11rem/14)] text-muted-foreground">
                {t('Need help choosing a setup? Ask Enso.')}
              </p>
              <Button variant="ghost" size="sm" onClick={summonEnso}>
                <Sparkles className="h-3.5 w-3.5" />
                {t('Ask Enso')}
              </Button>
            </div>
          )}
        </div>

        {/* 导航 */}
        <div className="flex items-center justify-between gap-[12px] border-t border-line px-[16px] py-[12px]">
          <Button variant="ghost" size="sm" onClick={prev} disabled={stepIndex === 0}>
            {t('Back')}
          </Button>
          <div className="flex items-center gap-2">
            {step !== 'done' && step !== 'welcome' && (
              <Button variant="ghost" size="sm" onClick={next}>
                {t('Skip')}
              </Button>
            )}
            {step === 'done' ? (
              <Button size="sm" onClick={finish}>
                {t('Done')}
              </Button>
            ) : (
              <Button size="sm" onClick={next}>
                {step === 'welcome' ? t('Get started') : t('Next')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 复用现有导入弹窗（受控） */}
      <LocalImportDialog open={providerOpen} onOpenChange={setProviderOpen} />
      <ProviderSetupWizard open={setupOpen} onOpenChange={setSetupOpen} />
      {importKind && (
        <LocalAssetImportDialog
          kind={importKind}
          open
          onOpenChange={(open) => !open && setImportKind(null)}
        />
      )}
      {presetOpen && <PresetEditDialog preset={null} onClose={() => setPresetOpen(false)} />}
    </div>
  );
}

function ImportStepView({
  icon: Icon,
  title,
  desc,
  count,
  onImport,
  importedLabel,
  importLabel,
  secondary,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
  count: number;
  onImport: () => void;
  importedLabel: string;
  importLabel: string;
  secondary?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-start gap-[8px]">
      <div className="flex items-center gap-[8px]">
        <Icon className="size-[calc(20rem/14)] text-primary" />
        <h2 className="text-[calc(18rem/14)] font-semibold leading-[calc(26rem/14)]">{title}</h2>
      </div>
      <p className="text-[calc(13rem/14)] leading-[calc(24rem/14)] text-muted-foreground">{desc}</p>
      <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
        <Button variant="outline" size="sm" onClick={onImport}>
          {importLabel}
        </Button>
        {secondary && (
          <Button variant="ghost" size="sm" onClick={secondary.onClick}>
            {secondary.label}
          </Button>
        )}
      </div>
      {count > 0 && <p className="text-[calc(11rem/14)] text-success">{importedLabel}</p>}
    </div>
  );
}
