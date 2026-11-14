import type {
  ExtensionPluginConfigField,
  ExtensionPluginInstallPreview,
  ExtensionPluginSummary,
} from '@shared/extensionPlugins/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { coerceConfigValue } from './configValue';

type PluginApi = Window['electronAPI']['extensionPlugins'];
type PluginStageKind = 'dir' | 'zip' | 'url' | 'market' | 'restage';
type ConfigDraft = Record<string, string | null>;
type Config = { pluginId: string; fields: ExtensionPluginConfigField[]; draft: ConfigDraft };
type OperationResult = {
  ok: boolean;
  error?: string;
  reason?: string;
  enabled?: boolean;
  warning?: string;
};
type Session = {
  api: PluginApi;
  busy: string | null;
  registryWritable: boolean;
  listGeneration: number;
  previewGeneration: number;
  preview: ExtensionPluginInstallPreview | null;
  removing: string | null;
};

export function isNativePluginUrl(value: string): boolean {
  const url = value.trim();
  if (url.length > 2048 || !/^https:\/\/[^/?#\\\s]/i.test(url)) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' && !!parsed.hostname && !parsed.username && !parsed.password
    );
  } catch {
    return false;
  }
}

export function pluginConfigPatch(
  fields: ExtensionPluginConfigField[],
  draft: ConfigDraft
): ConfigDraft {
  return Object.fromEntries(
    Object.entries(draft).filter(([key, value]) => {
      const field = fields.find((item) => item.key === key);
      return field && (value === null || !field.secret || value !== '');
    })
  );
}

function failureMessage(result: unknown): string {
  if (result && typeof result === 'object') {
    if ('error' in result && typeof result.error === 'string' && result.error) return result.error;
    if ('reason' in result && typeof result.reason === 'string' && result.reason)
      return result.reason;
  }
  return 'Plugin operation failed.';
}

function requireSuccess(result: OperationResult) {
  if (!result.ok) throw new Error(failureMessage(result));
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function discard(api: PluginApi, token: string): Promise<void> {
  requireSuccess(await api.discard(token));
}

/** Renderer-only management for the native registry; Main remains the install authority. */
export function useNativePluginManager() {
  const { t } = useI18n();
  const api =
    typeof window === 'undefined' ||
    (window.electronAPI && 'remote' in window.electronAPI && window.electronAPI.remote)
      ? undefined
      : window.electronAPI?.extensionPlugins;
  const sessionRef = useRef<Session | null>(null);
  const [plugins, setPlugins] = useState<ExtensionPluginSummary[]>([]);
  const [loading, setLoading] = useState(!!api);
  const [registryError, setRegistryError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExtensionPluginInstallPreview | null>(null);
  const [configuring, setConfiguring] = useState<Config | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(async (session: Session) => {
    const generation = ++session.listGeneration;
    const isCurrent = () => sessionRef.current === session && generation === session.listGeneration;
    try {
      const result = await session.api.list();
      if (!isCurrent()) return;
      if (!Array.isArray(result.plugins)) throw new Error(failureMessage(result));
      session.registryWritable = !result.registryError;
      setPlugins(result.plugins);
      setRegistryError(result.registryError ?? '');
      setLoadError('');
    } catch (reason) {
      if (isCurrent()) {
        session.registryWritable = false;
        setLoadError(message(reason));
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!api) return;
    const session: Session = {
      api,
      busy: null,
      registryWritable: false,
      listGeneration: 0,
      previewGeneration: 0,
      preview: null,
      removing: null,
    };
    sessionRef.current = session;
    setLoading(true);
    setBusy(null);
    setPreview(null);
    setConfiguring(null);
    setRemoving(null);
    const load = () => void refresh(session);
    const unsubscribe = api.onChanged(load);
    load();
    return () => {
      sessionRef.current = null;
      unsubscribe();
      if (session.preview) void discard(api, session.preview.token).catch(() => {});
    };
  }, [api, refresh]);

  // A ref guards against a second invocation before React commits the busy state.
  const run = async (
    key: string,
    operation: (session: Session) => Promise<void>,
    allowReadOnly = false
  ) => {
    const session = sessionRef.current;
    if (!session || session.busy || (!allowReadOnly && !session.registryWritable)) return;
    session.busy = key;
    setBusy(key);
    setError('');
    try {
      await operation(session);
    } catch (reason) {
      if (sessionRef.current === session) setError(message(reason));
    } finally {
      if (sessionRef.current === session) {
        session.busy = null;
        setBusy(null);
      }
    }
  };

  const takePreview = (session: Session) => {
    const current = session.preview;
    session.preview = null;
    session.previewGeneration++;
    setPreview(null);
    return current;
  };

  const stage = (kind: PluginStageKind, url = '') =>
    run(`stage:${kind}`, async (session) => {
      if (kind === 'url' && !isNativePluginUrl(url)) {
        throw new Error('Enter a valid HTTPS plugin URL without credentials.');
      }
      const old = takePreview(session);
      const generation = session.previewGeneration;
      if (old) {
        try {
          await discard(session.api, old.token);
        } catch (reason) {
          if (sessionRef.current === session) setError(message(reason));
        }
      }
      if (sessionRef.current !== session || !session.registryWritable) return;
      const result =
        kind === 'url'
          ? await session.api.stageFromUrl(url.trim())
          : kind === 'market'
            ? await session.api.marketStage(url)
            : kind === 'restage'
              ? await session.api.restage(url)
              : await session.api.pickAndStage(kind);
      requireSuccess(result);
      if (!result.ok || 'cancelled' in result) return;
      if (
        sessionRef.current !== session ||
        generation !== session.previewGeneration ||
        !session.registryWritable
      ) {
        const cleanup = discard(session.api, result.preview.token);
        if (sessionRef.current === session) await cleanup;
        else void cleanup.catch(() => {});
        return;
      }
      session.preview = result.preview;
      setPreview(result.preview);
    });

  const cancelPreview = () =>
    run(
      'discard',
      async (session) => {
        const current = takePreview(session);
        if (current) await discard(session.api, current.token);
      },
      true
    );

  const mutate = (
    key: string,
    operation: (session: Session) => Promise<OperationResult | undefined>
  ) =>
    run(key, async (session) => {
      const result = await operation(session);
      if (!result) return;
      requireSuccess(result);
      if (sessionRef.current === session) await refresh(session);
    });

  const confirmInstall = (token: string) =>
    mutate('commit', async (session) => {
      if (session.preview?.token !== token) return;
      const result = await session.api.commit(token);
      if (result.ok && sessionRef.current === session) {
        takePreview(session);
        // 安装成功但启用失败：插件已装好，只如实提示，不重试安装也不假报已启用
        if (result.enabled === false)
          setError(
            t('Installed, but enabling failed: {{error}}', {
              error: result.warning ?? t('Unknown error'),
            })
          );
      }
      return result;
    });

  const loadConfig = async (session: Session, pluginId: string) => {
    const result = await session.api.configGet(pluginId);
    requireSuccess(result);
    if (result.ok && sessionRef.current === session) {
      setConfiguring({ pluginId, fields: result.fields, draft: {} });
    }
  };

  const configure = (pluginId: string) =>
    run(
      `configure:${pluginId}`,
      async (session) => {
        setConfiguring({ pluginId, fields: [], draft: {} });
        await loadConfig(session, pluginId);
      },
      true
    );

  const setConfigValue = (key: string, value: string | null) => {
    const session = sessionRef.current;
    if (!session?.registryWritable || session.busy) return;
    setConfiguring(
      (current) => current && { ...current, draft: { ...current.draft, [key]: value } }
    );
  };

  const closeConfig = () => {
    if (sessionRef.current?.busy) return;
    setConfiguring(null);
    setError('');
  };

  const saveConfig = () =>
    run('config:save', async (session) => {
      if (!configuring) return;
      const { pluginId, fields, draft } = configuring;
      const rawPatch = pluginConfigPatch(fields, draft);
      const patch: Record<string, string | number | boolean | null> = {};
      for (const [key, value] of Object.entries(rawPatch)) {
        const field = fields.find((item) => item.key === key);
        if (!field) continue;
        const parsed = coerceConfigValue({ ...field, type: field.type ?? 'string' }, value);
        if (!parsed.ok) throw new Error(`${field.title}: ${parsed.error}`);
        patch[key] = parsed.value;
      }
      if (Object.keys(patch).length) requireSuccess(await session.api.configSet(pluginId, patch));
      if (sessionRef.current === session) await loadConfig(session, pluginId);
    });

  const uninstall = (pluginId: string) => {
    const session = sessionRef.current;
    if (!session?.registryWritable || session.busy) return;
    session.removing = pluginId;
    setError('');
    setRemoving(pluginId);
  };

  const cancelUninstall = () => {
    const session = sessionRef.current;
    if (!session || session.busy) return;
    session.removing = null;
    setRemoving(null);
    setError('');
  };

  const confirmUninstall = (pluginId: string) =>
    mutate(`uninstall:${pluginId}`, async (session) => {
      if (session.removing !== pluginId) return;
      const result = await session.api.uninstall(pluginId);
      if (result.ok && sessionRef.current === session) {
        session.removing = null;
        setRemoving(null);
        setConfiguring((current) => (current?.pluginId === pluginId ? null : current));
      }
      return result;
    });

  return {
    available: !!api,
    canManage: !!api && !loading && !registryError && !loadError,
    plugins,
    loading,
    error: error || loadError,
    registryError,
    busy,
    stage,
    checkUpdates: () => mutate('check-updates', ({ api }) => api.checkUpdates()),
    setDevWatch: (pluginId: string, on: boolean) =>
      mutate(`dev:${pluginId}`, ({ api }) => api.setDevWatch(pluginId, on)),
    setCrossSessionInject: (pluginId: string, on: boolean) =>
      mutate(`inject:${pluginId}`, ({ api }) => api.setCrossSessionInject(pluginId, on)),
    preview,
    cancelPreview,
    confirmInstall,
    setEnabled: (pluginId: string, enabled: boolean) =>
      mutate(`enable:${pluginId}`, ({ api }) => api.setEnabled(pluginId, enabled)),
    approvePending: (pluginId: string) =>
      mutate(`approve:${pluginId}`, ({ api }) => api.approvePending(pluginId)),
    rejectPending: (pluginId: string) =>
      mutate(`reject:${pluginId}`, ({ api }) => api.rejectPending(pluginId)),
    configure,
    configuring,
    setConfigValue,
    closeConfig,
    saveConfig,
    uninstall,
    removing,
    cancelUninstall,
    confirmUninstall,
  };
}

export type NativePluginManager = ReturnType<typeof useNativePluginManager>;
