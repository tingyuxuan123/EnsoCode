import type {
  ExtensionPluginConfigField,
  ExtensionPluginInstallPreview,
  ExtensionPluginSummary,
} from '@shared/extensionPlugins/types';
import { Puzzle, Settings2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/i18n';

export const PLUGIN_TRUST_WARNING =
  'Plugin main runs with full Node.js access. ui.js has the same access as the main interface. Install only plugins you fully trust. Permissions restrict Enso host APIs, not the plugin’s own code; this is not an OS sandbox.';

export function pluginConfigPatch(
  fields: ExtensionPluginConfigField[],
  draft: Record<string, string | null>
): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(draft).filter(([key, value]) => {
      const field = fields.find((item) => item.key === key);
      return field && (value === null || !field.secret || value !== '');
    })
  );
}

function ConfigForm({ pluginId }: { pluginId: string }) {
  const { t } = useI18n();
  const [fields, setFields] = useState<ExtensionPluginConfigField[]>([]);
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const result = await window.electronAPI.extensionPlugins.configGet(pluginId);
    if (!result.ok) throw new Error(result.error);
    setFields(result.fields);
    setDraft({});
  }, [pluginId]);
  useEffect(() => {
    void load().catch((reason) => setError(String(reason)));
  }, [load]);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI.extensionPlugins.configSet(
        pluginId,
        pluginConfigPatch(fields, draft)
      );
      if (!result.ok) throw new Error(result.error);
      await load();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 rounded-[6px] border border-line p-3">
      {fields.map((field) => (
        <label key={field.key} className="block space-y-1 text-[calc(13rem/14)]">
          <span>
            {field.title}{' '}
            <span className="text-muted-foreground">
              {field.secret ? (field.set ? t('Set (leave blank to keep)') : t('Not set')) : ''}
            </span>
          </span>
          {field.description && (
            <p className="text-muted-foreground text-[calc(12rem/14)]">{field.description}</p>
          )}
          <span className="flex items-center gap-2">
            <Input
              aria-label={field.title}
              type={field.secret ? 'password' : 'text'}
              autoComplete="off"
              disabled={busy}
              value={
                draft[field.key] === null
                  ? ''
                  : (draft[field.key] ?? (field.secret ? '' : (field.value ?? '')))
              }
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, [field.key]: event.target.value }))
              }
            />
            {field.set && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setDraft((previous) => ({ ...previous, [field.key]: null }))}
              >
                {draft[field.key] === null ? t('Will clear') : t('Clear value')}
              </Button>
            )}
          </span>
        </label>
      ))}
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      <Button
        size="sm"
        disabled={busy || Object.keys(draft).length === 0}
        onClick={() => void save()}
      >
        {t('Save')}
      </Button>
    </div>
  );
}

/** This list is independent of Claude Code plugins and settings.json. */
export function NativePluginsSection() {
  const { t } = useI18n();
  const [plugins, setPlugins] = useState<ExtensionPluginSummary[]>([]);
  const [registryError, setRegistryError] = useState('');
  const [preview, setPreview] = useState<ExtensionPluginInstallPreview | null>(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const generation = useRef(0);
  const api = typeof window === 'undefined' ? undefined : window.electronAPI?.extensionPlugins;
  const refresh = useCallback(async () => {
    if (api) {
      const result = await api.list();
      setPlugins(result.plugins);
      setRegistryError(result.registryError ?? '');
    }
  }, [api]);
  useEffect(() => {
    if (!api) return;
    let active = true;
    let version = 0;
    const load = () => {
      const mine = ++version;
      void api
        .list()
        .then((result) => {
          if (active && mine === version) {
            setPlugins(result.plugins);
            setRegistryError(result.registryError ?? '');
          }
        })
        .catch((reason) => {
          if (active) setError(String(reason));
        });
    };
    load();
    const unsubscribe = api.onChanged(load);
    return () => {
      active = false;
      generation.current++;
      unsubscribe();
      if (previewRef.current) void api.discard(previewRef.current.token);
    };
  }, [api]);
  const run = async (operation: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy || !api) return;
    setBusy(true);
    setError('');
    try {
      const result = await operation();
      if (!result.ok) throw new Error(result.error);
      await refresh();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const stage = async (kind: 'dir' | 'zip' | 'url') => {
    if (busy || !api) return;
    setBusy(true);
    setError('');
    const mine = ++generation.current;
    if (previewRef.current) void api.discard(previewRef.current.token);
    setPreview(null);
    try {
      const result =
        kind === 'url' ? await api.stageFromUrl(url.trim()) : await api.pickAndStage(kind);
      if (!result.ok) throw new Error(result.error);
      if ('cancelled' in result) return;
      if (mine !== generation.current) {
        void api.discard(result.preview.token);
        return;
      }
      setPreview(result.preview);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const cancelPreview = () => {
    if (busy || !api) return;
    if (preview) void api.discard(preview.token);
    setPreview(null);
  };
  return (
    <section className="space-y-3" data-settings-row="plugins.enso">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <h3 className="font-semibold text-[calc(18rem/14)]">{t('Enso plugins')}</h3>
          <p className="mt-1 text-muted-foreground text-[calc(13rem/14)]">
            {t(
              'Native plugins are separate from Claude Code plugins. New installs are disabled until you enable them.'
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !api}
            onClick={() => void stage('dir')}
          >
            {t('Install from folder')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !api}
            onClick={() => void stage('zip')}
          >
            {t('Install from zip')}
          </Button>
        </div>
      </div>
      <p className="rounded-[6px] border border-warning/40 bg-warning/5 p-3 text-[calc(12rem/14)]">
        {t(PLUGIN_TRUST_WARNING)}
      </p>
      <div className="flex gap-2">
        <Input
          aria-label={t('Plugin URL')}
          placeholder="https://example.com/plugin.zip"
          disabled={busy}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !api || !/^https?:\/\//i.test(url.trim())}
          onClick={() => void stage('url')}
        >
          {busy ? <Spinner /> : t('Preview URL')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-[calc(13rem/14)]">
          {error}
        </p>
      )}
      {registryError && <PluginRegistryAlert error={registryError} />}
      {!registryError && plugins.length === 0 && (
        <div className="rounded-[6px] border border-dashed p-6 text-center text-muted-foreground">
          <Puzzle className="mx-auto h-5 w-5" />
          <p className="mt-2 text-[calc(13rem/14)]">{t('No Enso plugins installed')}</p>
        </div>
      )}
      {plugins.map((plugin) => (
        <div key={plugin.id} className="space-y-2 rounded-[6px] border border-line p-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-[calc(13rem/14)]">
                {plugin.name} <span className="text-muted-foreground">{plugin.version}</span>
              </p>
              <p className="truncate font-mono text-muted-foreground text-[calc(11rem/14)]">
                {plugin.id}
              </p>
            </div>
            <Badge variant="outline">{plugin.state}</Badge>
            {plugin.configurable && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('Configure')}
                onClick={() => setConfiguring(configuring === plugin.id ? null : plugin.id)}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            )}
            <Switch
              aria-label={plugin.name}
              checked={plugin.state === 'enabled'}
              disabled={busy}
              onCheckedChange={(enabled) => void run(() => api!.setEnabled(plugin.id, enabled))}
            />
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label={t('Uninstall')}
              onClick={() => setRemoving(plugin.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {plugin.pendingVersion && (
            <div className="space-y-2 rounded-[6px] border border-warning/40 p-3 text-[calc(12rem/14)]">
              <p>
                {t('Pending update requires explicit permission approval')}: {plugin.pendingVersion}
              </p>
              <p className="break-all font-mono">{plugin.pendingPermissions?.join(' · ')}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(() => api!.approvePending(plugin.id))}
                >
                  {t('Approve update permissions')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(() => api!.rejectPending(plugin.id))}
                >
                  {t('Keep current')}
                </Button>
              </div>
            </div>
          )}
          {configuring === plugin.id && <ConfigForm pluginId={plugin.id} />}
        </div>
      ))}
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) cancelPreview();
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('Review plugin installation')}</DialogTitle>
          </DialogHeader>
          <DialogPanel className="space-y-3 text-[calc(13rem/14)]">
            {preview && (
              <>
                <p className="font-semibold">
                  {preview.name} {preview.version}
                </p>
                <p className="font-mono text-xs">
                  {preview.id}
                  {preview.existingVersion
                    ? ` (${preview.existingVersion} → ${preview.version})`
                    : ''}
                </p>
                <p>{preview.description}</p>
                <p className="text-warning-foreground">{t(PLUGIN_TRUST_WARNING)}</p>
                <Detail label={t('Permissions')} items={preview.permissions} />
                <Detail label="Host fs.read" items={preview.fsRead} />
                <Detail label="Host fs.write" items={preview.fsWrite} />
                <Detail label="Host net.fetch" items={preview.netDomains} />
                <Detail label="Host MCP tools" items={preview.mcpTools} />
                <Detail
                  label="MCP"
                  items={preview.mcpServers.map(
                    (server) =>
                      `${server.name}: ${server.command} ${server.args.join(' ')} (env: ${server.envKeys.join(', ')})`
                  )}
                />
                <Detail
                  label={t('Tools')}
                  items={preview.tools.map((tool) => `${tool.name}: ${tool.description}`)}
                />
                <Detail label={t('Warnings')} items={preview.warnings} />
                {preview.hasRenderer && <p>{t('Includes ui.js: full main-interface access')}</p>}
              </>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={cancelPreview}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={busy || !preview}
              onClick={() => {
                const token = preview?.token;
                if (token)
                  void run(async () => {
                    const result = await api!.commit(token);
                    if (result.ok) setPreview(null);
                    return result;
                  });
              }}
            >
              {t('Confirm install')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Uninstall plugin?')}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <p>{t('The plugin and its private data will be removed.')}</p>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setRemoving(null)}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                const id = removing;
                if (id)
                  void run(async () => {
                    const result = await api!.uninstall(id);
                    if (result.ok) setRemoving(null);
                    return result;
                  });
              }}
            >
              {t('Uninstall')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function PluginRegistryAlert({ error }: { error: string }) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className="rounded-[6px] border border-destructive p-3 text-destructive text-[calc(13rem/14)]"
    >
      <p>{t('Plugin registry is read-only. Restore the registry file before managing plugins.')}</p>
      <p className="break-all">{error}</p>
    </div>
  );
}
function Detail({ label, items }: { label: string; items: string[] }) {
  return items.length ? (
    <div>
      <p className="font-medium">{label}</p>
      {items.map((item) => (
        <p key={item} className="break-all font-mono text-xs text-muted-foreground">
          {item}
        </p>
      ))}
    </div>
  ) : null;
}
