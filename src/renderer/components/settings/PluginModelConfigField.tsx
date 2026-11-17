import { formatPluginModelChoice, parsePluginModelChoice } from '@shared/extensionPlugins/manifest';
import { MODEL_PICKER_FORM_TRIGGER_CLASS, ModelPicker } from '@/components/chat/ModelPicker';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/i18n';
import { useUsableProviders } from '@/stores/modelDirectory/useProviders';

const MODE_KEYS = {
  session: 'Follow current session',
  title: 'Follow title model',
  fixed: 'Specific model',
} as const;

/**
 * 插件 `type: model` 配置项：跟随当前会话、跟随标题模型，或从用户已配置的模型里指定一个。
 * 值只在 Main 解析成真实模型；这里不接触任何密钥。
 */
export function PluginModelConfigField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const providers = useUsableProviders();
  const choice = parsePluginModelChoice(value) ?? 'session';
  const mode = typeof choice === 'string' ? choice : 'fixed';
  const fixed = typeof choice === 'string' ? null : choice;
  const provider = fixed ? providers.find((entry) => entry.id === fixed.providerId) : undefined;
  const model = provider?.models.find((entry) => entry.id === fixed?.modelId);
  return (
    <div className="min-w-0 flex-1 space-y-2">
      <Select
        items={Object.fromEntries(Object.entries(MODE_KEYS).map(([key, label]) => [key, t(label)]))}
        value={mode}
        onValueChange={(next) => {
          if (next === 'session' || next === 'title') {
            onChange(next);
            return;
          }
          if (next !== 'fixed' || fixed) return;
          const first = providers[0];
          const firstModel = first?.models[0];
          if (first && firstModel)
            onChange(formatPluginModelChoice({ providerId: first.id, modelId: firstModel.id }));
        }}
      >
        <SelectTrigger aria-label={t('Model for plugin agent runs')}>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {Object.entries(MODE_KEYS).map(([key, label]) => (
            <SelectItem key={key} value={key} disabled={key === 'fixed' && providers.length === 0}>
              {t(label)}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {fixed && (
        <ModelPicker
          providers={providers}
          providerId={provider?.id ?? ''}
          modelId={model?.id ?? ''}
          reasoningEnabled={false}
          thinkingLevel="medium"
          showReasoningControls={false}
          emptyLabel={t('Choose a model')}
          side="bottom"
          triggerClassName={MODEL_PICKER_FORM_TRIGGER_CLASS}
          onSelect={(providerId, modelId) =>
            onChange(formatPluginModelChoice({ providerId, modelId }))
          }
          onReasoningChange={() => {}}
          onThinkingChange={() => {}}
        />
      )}
      {fixed && !model && (
        <p className="text-[calc(12rem/14)] text-destructive">
          {t('The selected model is no longer available. Runs will fail until you pick another.')}
        </p>
      )}
    </div>
  );
}
