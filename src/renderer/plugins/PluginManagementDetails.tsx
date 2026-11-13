import type { ExtensionPluginSummary } from '@shared/extensionPlugins/types';
import { useState } from 'react';
import { PluginReadmeDialog } from '@/components/settings/PluginReadmeDialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/i18n';
import { PluginManagedArtifacts } from './artifactViews';
import type { NativePluginManager } from './useNativePluginManager';
export function PluginManagementDetails({
  plugin,
  manager,
}: {
  plugin: ExtensionPluginSummary;
  manager: NativePluginManager;
}) {
  const { t } = useI18n();
  const [readme, setReadme] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const disabled = !manager.canManage || !!manager.busy;
  return (
    <div className="space-y-2 text-xs">
      {plugin.lastError && (
        <p role="alert" className="break-words text-destructive">
          {plugin.lastError.message}
        </p>
      )}
      {plugin.updateCheckError && (
        <p className="text-warning-foreground">{plugin.updateCheckError}</p>
      )}
      {plugin.resident && (
        <p>{t(plugin.running ? 'Background process running' : 'Background process stopped')}</p>
      )}
      {plugin.schedules?.map((schedule) => (
        <p key={schedule.id}>
          {schedule.id} · {schedule.intervalSeconds}s
          {schedule.lastError ? ` · ${schedule.lastError}` : ''}
        </p>
      ))}
      {plugin.interceptBreakers?.map((breaker) => (
        <p key={breaker.event}>
          {t('Event interception temporarily bypassed')}: {breaker.event}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setReadme(true)}>
          {t('Documentation')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void window.electronAPI.extensionPlugins
              .logs(plugin.id)
              .then((result) => setLogs(result.ok ? result.text : result.error))
          }
        >
          {t('Logs')}
        </Button>
        {plugin.source && (
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => void manager.stage('restage', plugin.id)}
          >
            {t(plugin.availableVersion ? 'Review update' : 'Reinstall from source')}
            {plugin.availableVersion ? ` ${plugin.availableVersion}` : ''}
          </Button>
        )}
      </div>
      {plugin.source?.kind === 'dir' && (
        <label className="flex items-center justify-between gap-2">
          {t('Development mode (watch folder)')}
          <Switch
            aria-label={t('Development mode (watch folder)')}
            disabled={disabled}
            checked={plugin.devWatch === true}
            onCheckedChange={(value) => void manager.setDevWatch(plugin.id, value)}
          />
        </label>
      )}
      {plugin.permissions.includes('agent.inject') && (
        <label className="flex items-center justify-between gap-2">
          {t('Allow injection into other sessions')}
          <Switch
            aria-label={t('Allow injection into other sessions')}
            disabled={disabled}
            checked={plugin.crossSessionInject === true}
            onCheckedChange={(value) => {
              if (
                !value ||
                window.confirm(
                  t('Allow this plugin to send messages to other sessions and trigger execution?')
                )
              )
                void manager.setCrossSessionInject(plugin.id, value);
            }}
          />
        </label>
      )}
      {logs !== null && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border p-2">
          {logs || t('No logs yet')}
        </pre>
      )}
      <Button variant="outline" size="sm" onClick={() => setArtifactsOpen((open) => !open)}>
        {t('Artifact files')}
      </Button>
      {artifactsOpen && <PluginManagedArtifacts pluginId={plugin.id} />}
      <PluginReadmeDialog
        plugin={readme ? { id: plugin.id, name: plugin.name, from: 'installed' } : null}
        onClose={() => setReadme(false)}
      />
    </div>
  );
}
