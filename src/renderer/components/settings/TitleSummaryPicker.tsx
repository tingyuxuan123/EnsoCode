import { MODEL_PICKER_FORM_TRIGGER_CLASS, ModelPicker } from '@/components/chat/ModelPicker';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/i18n';
import { useUsableProviders } from '@/stores/modelDirectory/useProviders';
import { useSettingsStore } from '@/stores/settings';

/**
 * 会话标题总结设置：开关 + 独立模型（null = 跟随全局默认）。
 * 模型菜单复用聊天区 ModelPicker；标题总结不开推理，不展示 reasoning 控件。
 */
export function TitleSummaryPicker() {
  const { t } = useI18n();
  const enabled = useSettingsStore((state) => state.titleSummaryEnabled);
  const setEnabled = useSettingsStore((state) => state.setTitleSummaryEnabled);
  const model = useSettingsStore((state) => state.titleSummaryModel);
  const setModel = useSettingsStore((state) => state.setTitleSummaryModel);
  const candidates = useUsableProviders();
  const selectedProvider = model
    ? candidates.find((entry) => entry.id === model.providerId)
    : undefined;
  const selectedModel = selectedProvider?.models.find((entry) => entry.id === model?.modelId);

  return (
    <section className="space-y-[10px] border-t border-line pt-[20px] first-of-type:border-t-0 first-of-type:pt-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h4 className="font-medium text-[calc(14rem/14)]">{t('Conversation title summary')}</h4>
          <p className="mt-0.5 text-muted-foreground text-[calc(12rem/14)]">
            {t('Generate a short AI title from the first message of a new conversation.')}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      {enabled && (
        <div className="space-y-2">
          {candidates.length > 0 && (
            <div className="w-full min-w-0">
              <ModelPicker
                providers={candidates}
                providerId={selectedProvider?.id ?? ''}
                modelId={selectedModel?.id ?? ''}
                reasoningEnabled={false}
                thinkingLevel="medium"
                showReasoningControls={false}
                emptyLabel={t('Follows the default model')}
                side="bottom"
                triggerClassName={MODEL_PICKER_FORM_TRIGGER_CLASS}
                onSelect={(providerId, modelId) => setModel({ providerId, modelId })}
                onReasoningChange={() => {}}
                onThinkingChange={() => {}}
              />
            </div>
          )}
          {model && (!selectedProvider || !selectedModel) && (
            <p className="text-muted-foreground text-[calc(12rem/14)]">
              {t('Selected model is unavailable — falls back to the default model.')}
            </p>
          )}
          {model && (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setModel(null)}>
              {t('Follow default model')}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
