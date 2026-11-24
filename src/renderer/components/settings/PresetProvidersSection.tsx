import { mergeFetchedModels } from '@shared/modelEntry';
import {
  PRESET_PROVIDERS,
  type PresetProviderDefinition,
  presetPortOf,
} from '@shared/presetProviders';
import type { FetchedModel, ListModelsResult, ModelProvider } from '@shared/types';
import { RefreshCw, Router } from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { PresetProviderPortDialog } from './PresetProviderPortDialog';

/**
 * 预设服务商：应用已经知道地址与密钥的本机服务，用户点一次启用即可。
 *
 * 启用后就是一条普通的 `ModelProvider`（带 `catalogId` 归组），不引入新的持久化结构。
 * 模型清单是**快照**：Magpie 侧删了模型，这里不会自动跟上，点「刷新模型」才同步
 * （`mergeFetchedModels` 会丢弃上游缺席的行）。这是刻意的手动语义，不是缺陷。
 */

/** 落盘时的条目 id。用固定值而不是随机 UUID：同一预设在本机只应有一条。 */
const presetEntryId = (preset: PresetProviderDefinition) => `preset-${preset.id}`;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/**
 * 请求用的密钥。**不能**把已落盘条目里的 `apiKey` 原样传回 IPC：
 * 那通常是 Main 侧的 `enso-secret:` 引用，而 `settingsSecrets` 的绑定 scope 是
 * `[api, baseUrl]`——一旦地址变了（改端口）引用就失效，IPC 只会回 `Invalid config`。
 * 预设的密钥本来就是固定值，直接用内置的即可。
 */
function presetApiKey(preset: PresetProviderDefinition, provider?: ModelProvider): string {
  const stored = provider?.apiKey;
  // 未启用（或用户手填过）时沿用条目自己的值；只有确实保存成引用才回落到内置密钥
  return stored && !stored.startsWith('enso-secret:') ? stored : preset.defaultApiKey;
}

export function PresetProvidersSection() {
  const { t } = useI18n();
  const providers = useSettingsStore((state) => state.providers);
  const addProviders = useSettingsStore((state) => state.addProviders);
  const updateProvider = useSettingsStore((state) => state.updateProvider);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [portDialogId, setPortDialogId] = React.useState<string | null>(null);

  /** 按 catalogId 认条目：用户手改过 api / name 也不影响识别。 */
  const providerFor = React.useCallback(
    (preset: PresetProviderDefinition): ModelProvider | undefined =>
      providers.find((provider) => provider.catalogId === preset.id),
    [providers]
  );

  const setError = React.useCallback((id: string, message: string | null) => {
    setErrors((current) => {
      if (message === null) {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      return { ...current, [id]: message };
    });
  }, []);

  /**
   * 拉一次模型。`ok` 与「有模型」必须同时成立才算成功：200 但空清单等于拿不到可用模型，
   * 落盘只会留下一个空壳。
   */
  const fetchModels = React.useCallback(
    async (
      preset: PresetProviderDefinition,
      baseUrl: string,
      apiKey: string,
      api: ModelProvider['api']
    ): Promise<{ ok: true; models: FetchedModel[] } | { ok: false }> => {
      let result: ListModelsResult;
      try {
        result = await window.electronAPI.providers.listModels({ api, apiKey, baseUrl });
      } catch (error) {
        setError(preset.id, t('Could not reach the local service. Start it, then try again.'));
        console.error('[preset-providers] 拉取模型异常：', error);
        return { ok: false };
      }
      if (!result.ok || result.models.length === 0) {
        // 地址/密钥类失败统一按「服务没起来」提示：本机代理类服务只有这一种现实原因，
        // 原文进控制台供排查，不把 HTTP 细节甩给用户。
        setError(preset.id, t('Could not reach the local service. Start it, then try again.'));
        if (!result.ok) console.error('[preset-providers] 拉取模型失败：', result.error);
        return { ok: false };
      }
      setError(preset.id, null);
      return { ok: true, models: result.models };
    },
    [setError, t]
  );

  /** 启用：拉通才落盘。已存在同端点同 key 的手动条目时复用它，不新增第二条。 */
  const enable = async (preset: PresetProviderDefinition) => {
    if (busyId) return;
    setBusyId(preset.id);
    try {
      const fetched = await fetchModels(preset, preset.baseUrl, preset.defaultApiKey, preset.api);
      if (!fetched.ok) return;

      // 去重：vendorOf 会把带 catalogId 的条目分到 magpie 桶，而手动加的 127.0.0.1 条目
      // 落在 local 桶，`applyIncomingProviders` 不会合并——不先查一次就会并存两条同端点条目。
      const existing = useSettingsStore.getState().providers.find(
        (provider) =>
          normalizeBaseUrl(provider.baseUrl) === normalizeBaseUrl(preset.baseUrl) &&
          // 手动加的条目存明文，已落盘的预设条目存引用；两者都算「同一个端点」
          presetApiKey(preset, provider) === preset.defaultApiKey
      );
      if (existing) {
        updateProvider(existing.id, {
          catalogId: preset.id,
          enabled: true,
          models: mergeFetchedModels(existing.models, fetched.models),
        });
        return;
      }

      addProviders([
        {
          id: presetEntryId(preset),
          name: preset.name,
          api: preset.api,
          apiKey: preset.defaultApiKey,
          baseUrl: preset.baseUrl,
          enabled: true,
          catalogId: preset.id,
          models: mergeFetchedModels([], fetched.models),
        },
      ]);
    } finally {
      setBusyId(null);
    }
  };

  /** 手动刷新：唯一与上游对齐的入口。上游缺席的模型会被丢弃。 */
  const refresh = async (preset: PresetProviderDefinition, provider: ModelProvider) => {
    if (busyId) return;
    setBusyId(preset.id);
    try {
      const fetched = await fetchModels(
        preset,
        provider.baseUrl,
        presetApiKey(preset, provider),
        provider.api
      );
      if (!fetched.ok) return;
      updateProvider(provider.id, {
        models: mergeFetchedModels(provider.models, fetched.models),
      });
    } finally {
      setBusyId(null);
    }
  };

  /** 改端口：先用新地址拉通再落盘，拉不通就保留原地址。 */
  const changePort = async (
    preset: PresetProviderDefinition,
    provider: ModelProvider,
    nextBaseUrl: string
  ): Promise<boolean> => {
    if (busyId) return false;
    setBusyId(preset.id);
    try {
      const fetched = await fetchModels(
        preset,
        nextBaseUrl,
        presetApiKey(preset, provider),
        provider.api
      );
      if (!fetched.ok) {
        addToast({
          type: 'error',
          title: t('Could not reach the local service. Start it, then try again.'),
        });
        return false;
      }
      updateProvider(provider.id, {
        baseUrl: nextBaseUrl,
        // 必须连 apiKey 一起写回明文：Main 的 settingsSecrets 用 `[api, baseUrl]` 当绑定 scope，
        // 只改地址会让旧的 `enso-secret:` 引用找不到归属而判定 stale，整次写入被拒
        // （现象是端口弹窗显示成功、磁盘上仍是旧地址）。预设密钥是固定值，写明文即正确。
        apiKey: preset.defaultApiKey,
        models: mergeFetchedModels(provider.models, fetched.models),
      });
      return true;
    } finally {
      setBusyId(null);
    }
  };

  const rows = PRESET_PROVIDERS.map((preset) => {
    const provider = providerFor(preset);
    return {
      preset,
      provider,
      baseUrl: provider?.baseUrl ?? preset.baseUrl,
      busy: busyId === preset.id,
      error: errors[preset.id] ?? null,
    };
  });

  return (
    <section
      className="space-y-2"
      data-settings-row="providers.presets"
      aria-label={t('Preset providers')}
    >
      <div className="flex items-baseline gap-1.5">
        <h4 className="text-[calc(13rem/14)] font-semibold">{t('Preset providers')}</h4>
      </div>
      <p className="text-[calc(12rem/14)] text-muted-foreground">
        {t(
          'Preset providers are local services this app already knows how to reach. Enabling one fetches its model list and adds it as a normal provider.'
        )}
      </p>
      <div className="rounded-[6px] border">
        {rows.map((row) => (
          <PresetProviderRow
            key={row.preset.id}
            name={row.preset.name}
            baseUrl={row.baseUrl}
            provider={row.provider}
            busy={row.busy}
            error={row.error}
            portEditable={row.preset.portEditable}
            onEnable={() => void enable(row.preset)}
            onRefresh={() => row.provider && void refresh(row.preset, row.provider)}
            onToggle={(enabled) => row.provider && updateProvider(row.provider.id, { enabled })}
            onOpenPortDialog={() => setPortDialogId(row.preset.id)}
          />
        ))}
      </div>
      {rows.map((row) => (
        <PresetProviderPortDialog
          key={`port-${row.preset.id}`}
          open={portDialogId === row.preset.id && row.provider !== undefined}
          onOpenChange={(open) => setPortDialogId(open ? row.preset.id : null)}
          name={row.preset.name}
          baseUrl={row.baseUrl}
          saving={row.busy}
          onSubmit={(nextBaseUrl) =>
            row.provider
              ? changePort(row.preset, row.provider, nextBaseUrl)
              : Promise.resolve(false)
          }
        />
      ))}
    </section>
  );
}

interface PresetProviderRowProps {
  name: string;
  baseUrl: string;
  provider: ModelProvider | undefined;
  busy: boolean;
  error: string | null;
  portEditable: boolean;
  onEnable: () => void;
  onRefresh: () => void;
  onToggle: (enabled: boolean) => void;
  onOpenPortDialog: () => void;
}

function PresetProviderRow({
  name,
  baseUrl,
  provider,
  busy,
  error,
  portEditable,
  onEnable,
  onRefresh,
  onToggle,
  onOpenPortDialog,
}: PresetProviderRowProps) {
  const { t } = useI18n();
  const enabled = Boolean(provider?.enabled);
  const modelCount = provider?.models.length ?? 0;
  const port = presetPortOf(baseUrl);

  return (
    <div
      className="flex items-start justify-between gap-[12px] px-[12px] py-[10px]"
      data-preset-row={name}
    >
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 items-center gap-2">
          <Router className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span
            className={cn(
              'truncate text-[calc(13rem/14)] font-medium',
              provider && !enabled && 'text-muted-foreground line-through'
            )}
          >
            {name}
          </span>
          {enabled && (
            <Badge variant="outline" className="shrink-0 text-[calc(11rem/14)]">
              {t('Enabled')}
            </Badge>
          )}
          <span className="min-w-0 truncate text-[calc(12rem/14)] text-muted-foreground">
            {[provider ? t('{{count}} models', { count: modelCount }) : undefined, baseUrl]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        {error && (
          <p role="status" className="mt-1 break-words text-[calc(12rem/14)] text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 pt-0.5">
        {provider ? (
          <>
            {portEditable && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[calc(12rem/14)] text-muted-foreground"
                disabled={busy}
                onClick={onOpenPortDialog}
              >
                {port ? `:${port}` : t('Change port')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              disabled={busy}
              title={t('Refresh models')}
              aria-label={t('Refresh models')}
              onClick={onRefresh}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
            </Button>
            <Switch checked={enabled} onCheckedChange={onToggle} aria-label={name} />
          </>
        ) : (
          <Button size="sm" disabled={busy} onClick={onEnable}>
            {busy && <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {t('Enable')}
          </Button>
        )}
      </div>
    </div>
  );
}
