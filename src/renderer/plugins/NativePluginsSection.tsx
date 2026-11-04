import { Puzzle, Settings2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/i18n';
import {
  NativePluginConfigForm,
  NativePluginFlows,
  PLUGIN_TRUST_WARNING,
  PluginRegistryAlert,
} from './NativePluginFlows';
import { isNativePluginUrl, useNativePluginManager } from './useNativePluginManager';

export { PLUGIN_TRUST_WARNING, PluginRegistryAlert } from './NativePluginFlows';
export { pluginConfigPatch } from './useNativePluginManager';

/** This list is independent of Claude Code plugins and settings.json. */
export function NativePluginsSection() {
  const { t } = useI18n();
  const manager = useNativePluginManager();
  const { plugins, busy, error, loading, registryError, canManage, configuring } = manager;
  const [url, setUrl] = useState('');
  const disabled = !!busy || !canManage;
  const flowOpen = !!manager.preview || !!manager.removing || !!configuring;
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
            disabled={disabled}
            onClick={() => void manager.stage('dir')}
          >
            {t('Install from folder')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => void manager.stage('zip')}
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
          disabled={disabled}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !isNativePluginUrl(url)}
          onClick={() => void manager.stage('url', url)}
        >
          {busy ? <Spinner /> : t('Preview URL')}
        </Button>
      </div>
      {error && !flowOpen && (
        <p role="alert" className="text-destructive text-[calc(13rem/14)]">
          {error}
        </p>
      )}
      {registryError && <PluginRegistryAlert error={registryError} />}
      {!loading && !registryError && plugins.length === 0 && (
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
                disabled={!!busy || !manager.available}
                onClick={() =>
                  configuring?.pluginId === plugin.id
                    ? manager.closeConfig()
                    : void manager.configure(plugin.id)
                }
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            )}
            <Switch
              aria-label={plugin.name}
              checked={plugin.state === 'enabled'}
              disabled={disabled}
              onCheckedChange={(enabled) => void manager.setEnabled(plugin.id, enabled)}
            />
            <Button
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label={t('Uninstall')}
              onClick={() => manager.uninstall(plugin.id)}
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
                  disabled={disabled}
                  onClick={() => void manager.approvePending(plugin.id)}
                >
                  {t('Approve update permissions')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void manager.rejectPending(plugin.id)}
                >
                  {t('Keep current')}
                </Button>
              </div>
            </div>
          )}
          {configuring?.pluginId === plugin.id && <NativePluginConfigForm manager={manager} />}
        </div>
      ))}
      <NativePluginFlows manager={manager} inlineConfig />
    </section>
  );
}
