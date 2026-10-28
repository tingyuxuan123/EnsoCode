import type { DefaultModelRef } from '@shared/defaultModel';
import type { ModelProvider } from '@shared/types';
import { CircleAlert, Server } from 'lucide-react';
import { MODEL_PICKER_FORM_TRIGGER_CLASS, ModelPicker } from '@/components/chat/ModelPicker';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { useMaterializedProviders, useUsableProviders } from '@/stores/modelDirectory/useProviders';
import { useOauthCredentialStore } from '@/stores/oauthCredentials';
import { useDefaultModelRevalidationStore, useSettingsStore } from '@/stores/settings';

function selectionLabel(selection: DefaultModelRef, providers: readonly ModelProvider[]): string {
  const provider = providers.find((entry) => entry.id === selection.providerId);
  const model = provider?.models.find((entry) => entry.id === selection.modelId);
  return `${provider?.name ?? selection.providerId} / ${model?.label ?? selection.modelId}`;
}

/** 设置页的全局默认模型入口；账号分组与模型菜单完全复用聊天区 ModelPicker。 */
export function DefaultModelPicker() {
  const { t } = useI18n();
  const providers = useMaterializedProviders();
  const virtualModels = useSettingsStore((state) => state.virtualModels);
  const defaultModel = useSettingsStore((state) => state.defaultModel);
  const setDefaultModel = useSettingsStore((state) => state.setDefaultModel);
  const defaultModelFollowLast = useSettingsStore((state) => state.defaultModelFollowLast);
  const setDefaultModelFollowLast = useSettingsStore((state) => state.setDefaultModelFollowLast);
  const defaultReasoningEnabled = useSettingsStore((state) => state.defaultReasoningEnabled);
  const defaultThinkingLevel = useSettingsStore((state) => state.defaultThinkingLevel);
  const setDefaultReasoningEnabled = useSettingsStore((state) => state.setDefaultReasoningEnabled);
  const setDefaultThinkingLevel = useSettingsStore((state) => state.setDefaultThinkingLevel);
  const snapshot = useOauthCredentialStore((state) => state.snapshot);
  const revalidation = useDefaultModelRevalidationStore((state) => state.latest);
  const candidates = useUsableProviders();
  const selectedProvider = defaultModel
    ? candidates.find((entry) => entry.id === defaultModel.providerId)
    : undefined;
  const selectedModel = selectedProvider?.models.find(
    (entry) => entry.id === defaultModel?.modelId
  );
  const hasOauthProviders = providers.some((provider) => Boolean(provider.oauthAccountKey));
  const credentialsPending =
    hasOauthProviders &&
    (snapshot.availability.status === 'unloaded' || snapshot.availability.status === 'loading');
  const credentialsError =
    hasOauthProviders && snapshot.availability.status === 'error'
      ? snapshot.availability.error
      : null;

  const notice = revalidation?.notice;
  const noticeText = notice
    ? t('Default model changed: {{previous}} → {{next}}', {
        previous: selectionLabel(notice.previous, providers),
        next: notice.next ? selectionLabel(notice.next, providers) : t('No default model'),
      })
    : null;

  return (
    <section className="space-y-2 rounded-[6px] border bg-card p-3">
      <div className="min-w-0">
        <h4 className="font-medium text-[13px]">{t('Default model')}</h4>
        <p className="mt-0.5 text-muted-foreground text-[12px]">
          {t(
            defaultModelFollowLast
              ? 'New conversations use the last model you picked.'
              : 'Used for new conversations.'
          )}
        </p>
      </div>
      {candidates.length > 0 && (
        <div className="w-full min-w-0">
          <ModelPicker
            providers={candidates}
            virtualModels={virtualModels}
            providerId={selectedProvider?.id ?? defaultModel?.providerId ?? ''}
            modelId={selectedModel?.id ?? defaultModel?.modelId ?? ''}
            reasoningEnabled={defaultReasoningEnabled}
            thinkingLevel={defaultThinkingLevel}
            emptyLabel={t('Select model')}
            triggerLabel={defaultModelFollowLast ? t('Follow last selection') : undefined}
            side="bottom"
            triggerClassName={MODEL_PICKER_FORM_TRIGGER_CLASS}
            onSelect={(providerId, modelId) => setDefaultModel({ providerId, modelId })}
            onReasoningChange={setDefaultReasoningEnabled}
            onThinkingChange={setDefaultThinkingLevel}
            showReasoningControls={!defaultModelFollowLast}
          />
        </div>
      )}
      {!defaultModelFollowLast && candidates.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setDefaultModelFollowLast(true)}
        >
          {t('Follow last selection')}
        </Button>
      )}

      {candidates.length === 0 && (
        <div className="rounded-[6px] border border-dashed px-3 py-5 text-center">
          <Server className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-2 font-medium text-[13px]">{t('No usable models')}</p>
          <p className="mt-1 text-muted-foreground text-[12px]">
            {t('Enable a model and configure valid provider credentials first.')}
          </p>
        </div>
      )}

      {(credentialsPending || credentialsError) && (
        <div className="flex items-start gap-2 rounded-[6px] bg-muted px-2.5 py-2 text-[12px]">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">
            {credentialsError
              ? t('Subscription credentials could not be loaded: {{error}}', {
                  error: credentialsError,
                })
              : t('Subscription credentials are loading. API-key models remain available.')}
          </span>
        </div>
      )}

      {noticeText && (
        <p className="rounded-[6px] bg-muted px-2.5 py-2 text-muted-foreground text-[12px]">
          {noticeText}
        </p>
      )}
    </section>
  );
}
