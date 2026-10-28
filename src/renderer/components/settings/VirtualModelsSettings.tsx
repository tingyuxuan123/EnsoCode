import type { DefaultModelRef } from '@shared/defaultModel';
import type { ModelProvider } from '@shared/types';
import {
  CLASSIFIER_TIMEOUT_MAX_MS,
  CLASSIFIER_TIMEOUT_MIN_MS,
  canBeVirtualMember,
  clampClassifierTimeoutMs,
  VIRTUAL_CLASSIFIER_DEFAULT_TIMEOUT_MS,
  type VirtualClassifierConfig,
  type VirtualModelEntry,
} from '@shared/virtualModels';
import { Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { MODEL_PICKER_FORM_TRIGGER_CLASS, ModelPicker } from '@/components/chat/ModelPicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import {
  useUsableClassifierProviders,
  useUsableProviders,
} from '@/stores/modelDirectory/useProviders';
import { useSettingsStore } from '@/stores/settings';

const noop = () => undefined;
const OFF = 'off';

/** 换来源/模型时沿用已有时限，用户设过的标记一并保留 */
const keepTimeout = (classifier: VirtualClassifierConfig | undefined) => ({
  timeoutMs: classifier?.timeoutMs ?? VIRTUAL_CLASSIFIER_DEFAULT_TIMEOUT_MS,
  ...(classifier?.timeoutSet && { timeoutSet: true as const }),
});

function ClassifierTimeoutInput({
  classifier,
  effectiveMs,
  hint,
  onChange,
}: {
  classifier: VirtualClassifierConfig;
  effectiveMs: number;
  hint: string;
  onChange: (next: VirtualClassifierConfig) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(String(effectiveMs / 1000));
  useEffect(() => setDraft(String(effectiveMs / 1000)), [effectiveMs]);
  const commit = () => {
    const seconds = Number(draft);
    if (!draft.trim() || !Number.isFinite(seconds)) return setDraft(String(effectiveMs / 1000));
    const timeoutMs = clampClassifierTimeoutMs(seconds * 1000);
    setDraft(String(timeoutMs / 1000));
    if (timeoutMs !== effectiveMs) onChange({ ...classifier, timeoutMs, timeoutSet: true });
  };
  return (
    <div className="flex items-center gap-2">
      <span className="text-[calc(12rem/14)]">{t('Timeout')}</span>
      <Input
        type="number"
        value={draft}
        min={CLASSIFIER_TIMEOUT_MIN_MS / 1000}
        max={CLASSIFIER_TIMEOUT_MAX_MS / 1000}
        step={0.5}
        className="h-7 w-20 text-[calc(12rem/14)]"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      <span className="text-[calc(12rem/14)] text-muted-foreground">{t('seconds')}</span>
      <span className="text-[calc(11rem/14)] text-muted-foreground">{hint}</span>
    </div>
  );
}

function MemberPicker({
  providers,
  value,
  emptyLabel,
  onSelect,
}: {
  providers: ModelProvider[];
  value: DefaultModelRef | undefined;
  emptyLabel?: string;
  onSelect: (ref: DefaultModelRef) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <ModelPicker
        providers={providers}
        providerId={value?.providerId ?? ''}
        modelId={value?.modelId ?? ''}
        reasoningEnabled={false}
        thinkingLevel="medium"
        showReasoningControls={false}
        emptyLabel={emptyLabel}
        side="bottom"
        triggerClassName={MODEL_PICKER_FORM_TRIGGER_CLASS}
        onSelect={(providerId, modelId) => onSelect({ providerId, modelId })}
        onReasoningChange={noop}
        onThinkingChange={noop}
      />
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-start gap-2">
      <div className="pt-1.5 text-[calc(12rem/14)]">
        <div>{label}</div>
        {hint && <div className="text-[calc(11rem/14)] text-muted-foreground">{hint}</div>}
      </div>
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

/** 分类来源：关/默认 · 快模型裁判 · pi 分类器（只在有可用分类器 provider 时出现） */
export function ClassifierSourceField({
  value,
  onChange,
  providers,
  classifierProviders,
  offLabel,
  judgeLabel,
  judgeSeed,
  description,
  effectiveTimeoutMs,
  timeoutHint,
}: {
  value: VirtualClassifierConfig | undefined;
  onChange: (next: VirtualClassifierConfig | undefined) => void;
  providers: ModelProvider[];
  classifierProviders: ModelProvider[];
  offLabel: string;
  judgeLabel: string;
  /** 切到裁判时预填的模型；缺省时等用户选定模型再保存 */
  judgeSeed?: DefaultModelRef;
  description: string;
  /** 运行时实际时限；缺省即 timeoutMs */
  effectiveTimeoutMs?: number;
  timeoutHint: string;
}) {
  const { t } = useI18n();
  const classifier = value;
  const [judgeDraft, setJudgeDraft] = useState(false);
  const source = classifier?.source ?? (judgeDraft ? 'judge' : OFF);
  const piProviderId = classifier?.source === 'pi-classifier' ? classifier.model.providerId : '';
  const [piModels, setPiModels] = useState<Array<{ id: string; name: string }>>([]);
  const [noClassifierModels, setNoClassifierModels] = useState(false);
  useEffect(() => {
    if (!piProviderId) {
      setPiModels([]);
      return;
    }
    let cancelled = false;
    void window.electronAPI.providers.classifierModels(piProviderId).then((models) => {
      if (!cancelled) setPiModels(models);
    });
    return () => {
      cancelled = true;
    };
  }, [piProviderId]);
  // 分类器模型 id 为空的配置会被解析丢弃（跨窗口重读后跳回“关”），选来源/换 provider 时直接带上首个模型
  const pickPiClassifier = async (providerId: string) => {
    const models = await window.electronAPI.providers.classifierModels(providerId);
    const first = models[0];
    setNoClassifierModels(!first);
    if (!first) return;
    onChange({
      source: 'pi-classifier',
      model: { providerId, modelId: first.id },
      ...keepTimeout(classifier),
    });
  };
  const setSource = (next: string) => {
    setNoClassifierModels(false);
    setJudgeDraft(next === 'judge' && !judgeSeed);
    if (next === OFF) return onChange(undefined);
    if (next === 'judge') {
      if (!judgeSeed) return onChange(undefined);
      return onChange({
        source: 'judge',
        model: judgeSeed,
        ...keepTimeout(classifier),
      });
    }
    const provider = classifierProviders[0];
    if (provider) void pickPiClassifier(provider.id);
  };
  const sourceItems = [
    { value: OFF, label: offLabel },
    { value: 'judge', label: judgeLabel },
    ...(classifierProviders.length > 0
      ? [{ value: 'pi-classifier', label: t('Classifier model') }]
      : []),
  ];
  return (
    <div className="space-y-1">
      <Select items={sourceItems} value={source} onValueChange={(next) => setSource(String(next))}>
        <SelectTrigger size="sm" className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {sourceItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {source === 'judge' && (
        <MemberPicker
          providers={providers}
          value={classifier?.source === 'judge' ? classifier.model : undefined}
          emptyLabel={t('Select model')}
          onSelect={(model) => {
            setJudgeDraft(false);
            onChange({
              source: 'judge',
              model,
              ...keepTimeout(classifier),
            });
          }}
        />
      )}
      {classifier?.source === 'pi-classifier' && (
        <div className="flex gap-1">
          <Select
            items={classifierProviders.map((p) => ({ value: p.id, label: p.name }))}
            value={classifier.model.providerId}
            onValueChange={(next) => void pickPiClassifier(String(next))}
          >
            <SelectTrigger size="sm" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {classifierProviders.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Select
            items={piModels.map((m) => ({ value: m.id, label: m.name }))}
            value={classifier.model.modelId || null}
            onValueChange={(next) =>
              onChange({
                ...classifier,
                model: { providerId: classifier.model.providerId, modelId: String(next) },
              })
            }
          >
            <SelectTrigger size="sm" className="min-w-0 flex-1">
              <SelectValue placeholder={t('Select model')} />
            </SelectTrigger>
            <SelectPopup>
              {piModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      )}
      {noClassifierModels && (
        <p className="text-[calc(11rem/14)] text-destructive">
          {t('No classifier models available')}
        </p>
      )}
      {classifier && (
        <ClassifierTimeoutInput
          classifier={classifier}
          effectiveMs={effectiveTimeoutMs ?? classifier.timeoutMs}
          hint={timeoutHint}
          onChange={onChange}
        />
      )}
      <p className="text-[calc(11rem/14)] text-muted-foreground">{description}</p>
    </div>
  );
}

function ClassifierField({
  entry,
  providers,
  classifierProviders,
  update,
}: {
  entry: VirtualModelEntry;
  providers: ModelProvider[];
  classifierProviders: ModelProvider[];
  update: (updates: Partial<Omit<VirtualModelEntry, 'id'>>) => void;
}) {
  const { t } = useI18n();
  if (!entry.fast) {
    return (
      <p className="pt-1.5 text-[calc(11rem/14)] text-muted-foreground">
        {t('Set a fast model first')}
      </p>
    );
  }
  return (
    <ClassifierSourceField
      value={entry.classifier}
      onChange={(classifier) => update({ classifier })}
      providers={providers}
      classifierProviders={classifierProviders}
      offLabel={t('Off')}
      judgeLabel={t('Fast model judges')}
      judgeSeed={entry.fast}
      description={t(
        'Classifies each new turn: simple turns use the fast model, complex ones the primary model. Adds a short delay before the reply.'
      )}
      timeoutHint={t('Uses the primary model on timeout.')}
    />
  );
}

function VirtualModelCard({
  entry,
  providers,
  classifierProviders,
}: {
  entry: VirtualModelEntry;
  providers: ModelProvider[];
  classifierProviders: ModelProvider[];
}) {
  const { t } = useI18n();
  const updateEntry = useSettingsStore((state) => state.updateVirtualModel);
  const removeEntry = useSettingsStore((state) => state.removeVirtualModel);
  const used = [entry.primary, ...(entry.fast ? [entry.fast] : []), ...entry.fallbacks];
  let nextFallback: DefaultModelRef | undefined;
  for (const provider of providers) {
    const model = provider.models.find(
      (item) =>
        item.enabled !== false &&
        !used.some((ref) => ref.providerId === provider.id && ref.modelId === item.id)
    );
    if (model) {
      nextFallback = { providerId: provider.id, modelId: model.id };
      break;
    }
  }
  const update = (updates: Partial<Omit<VirtualModelEntry, 'id'>>) =>
    updateEntry(entry.id, updates);
  return (
    <div
      data-slot="virtual-model-card"
      className={cn(
        'space-y-2 rounded-[6px] border p-2',
        !entry.enabled && 'bg-muted/50 text-muted-foreground'
      )}
    >
      <div className="flex items-center gap-2">
        <Switch
          aria-label={t('Enable virtual model')}
          checked={entry.enabled}
          onCheckedChange={(enabled) => update({ enabled })}
        />
        <Input
          value={entry.name}
          maxLength={60}
          placeholder="Auto"
          className="h-7 flex-1 text-[calc(12rem/14)]"
          onChange={(event) => update({ name: event.target.value })}
        />
        {!entry.enabled && (
          <Badge variant="outline" className="shrink-0 text-[calc(11rem/14)] text-muted-foreground">
            {t('Disabled')}
          </Badge>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('Delete')}
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => removeEntry(entry.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Field label={t('Primary model')} hint={t('Default for each new turn')}>
        <MemberPicker
          providers={providers}
          value={entry.primary}
          onSelect={(primary) =>
            update({
              primary,
              fallbacks: entry.fallbacks.filter(
                (ref) => ref.providerId !== primary.providerId || ref.modelId !== primary.modelId
              ),
            })
          }
        />
      </Field>
      <Field label={t('Fast model')} hint={t('Summaries and simple turns')}>
        <div className="flex items-center gap-1">
          <MemberPicker
            providers={providers}
            value={entry.fast}
            emptyLabel={t('Not used')}
            onSelect={(fast) => update({ fast })}
          />
          {entry.fast && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('Clear')}
              className="h-6 w-6 shrink-0 text-muted-foreground"
              onClick={() => update({ fast: undefined })}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </Field>
      <Field
        label={t('Fallback models')}
        hint={t('Used in order when a model is rate limited or down')}
      >
        {entry.fallbacks.map((ref, index) => (
          <div key={`${ref.providerId}/${ref.modelId}`} className="flex items-center gap-1">
            <MemberPicker
              providers={providers}
              value={ref}
              onSelect={(next) =>
                update({
                  fallbacks: entry.fallbacks.map((item, at) => (at === index ? next : item)),
                })
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('Delete')}
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => update({ fallbacks: entry.fallbacks.filter((_, at) => at !== index) })}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-[calc(12rem/14)]"
          disabled={!nextFallback || entry.fallbacks.length >= 8}
          onClick={() => {
            if (nextFallback) update({ fallbacks: [...entry.fallbacks, nextFallback] });
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('Add fallback')}
        </Button>
      </Field>
      <Field label={t('Difficulty routing')}>
        <ClassifierField
          entry={entry}
          providers={providers}
          classifierProviders={classifierProviders}
          update={update}
        />
      </Field>
    </div>
  );
}

/**
 * 虚拟模型：在模型选择器里出现为一个模型，每次请求由路由挑真实成员。
 * 成员不含 Cursor（不经 pi 请求管线）。
 */
export function VirtualModelsSettings() {
  const { t } = useI18n();
  const entries = useSettingsStore((state) => state.virtualModels);
  const addEntry = useSettingsStore((state) => state.addVirtualModel);
  const defaultModel = useSettingsStore((state) => state.defaultModel);
  const usable = useUsableProviders();
  const candidates = useMemo(() => usable.filter(canBeVirtualMember), [usable]);
  const classifierProviders = useUsableClassifierProviders();
  const seed = useMemo((): DefaultModelRef | null => {
    if (defaultModel) {
      const provider = candidates.find((entry) => entry.id === defaultModel.providerId);
      if (provider?.models.some((m) => m.id === defaultModel.modelId && m.enabled !== false)) {
        return defaultModel;
      }
    }
    for (const provider of candidates) {
      const model = provider.models.find((entry) => entry.enabled !== false);
      if (model) return { providerId: provider.id, modelId: model.id };
    }
    return null;
  }, [candidates, defaultModel]);

  return (
    <section data-slot="virtual-models" className="space-y-2 rounded-[6px] border bg-card p-3">
      <div>
        <h4 className="font-medium text-[calc(13rem/14)]">{t('Virtual models')}</h4>
        <p className="mt-0.5 text-muted-foreground text-[calc(12rem/14)]">
          {t(
            'A virtual model appears as one model in the picker and routes each request to a real model: fallbacks on rate limits or outages, image-capable or larger-context members when needed, and the fast model for summaries.'
          )}
        </p>
        <p className="mt-1 text-muted-foreground text-[calc(12rem/14)]">
          {t('Applies to newly started conversations.')}
        </p>
      </div>
      <div className="space-y-2">
        {entries.map((entry) => (
          <VirtualModelCard
            key={entry.id}
            entry={entry}
            providers={candidates}
            classifierProviders={classifierProviders}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-[calc(12rem/14)]"
          disabled={!seed}
          onClick={() => {
            if (seed) addEntry({ name: 'Auto', enabled: true, primary: seed, fallbacks: [] });
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('New virtual model')}
        </Button>
        {!seed && (
          <p className="text-muted-foreground text-[calc(12rem/14)]">
            {t('Enable a model and configure valid provider credentials first.')}
          </p>
        )}
      </div>
    </section>
  );
}
