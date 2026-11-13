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
import { useI18n } from '@/i18n';
import type { NativePluginManager } from './useNativePluginManager';

export const PLUGIN_TRUST_WARNING =
  'Plugin main runs with full Node.js access. ui.js has the same access as the main interface. Install only plugins you fully trust. Permissions restrict Collabra host APIs, not the plugin’s own code; this is not an OS sandbox.';

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

function FlowAlerts({ manager }: { manager: NativePluginManager }) {
  return (
    <>
      {manager.error && (
        <p role="alert" className="break-words text-destructive text-xs">
          {manager.error}
        </p>
      )}
      {manager.registryError && <PluginRegistryAlert error={manager.registryError} />}
    </>
  );
}

/** Settings can keep configuration inline while other surfaces use the configuration dialog. */
export function NativePluginConfigForm({ manager }: { manager: NativePluginManager }) {
  const { t } = useI18n();
  const { configuring, busy, canManage, setConfigValue, saveConfig } = manager;
  if (!configuring) return null;
  const { fields, draft } = configuring;
  const disabled = !!busy || !canManage;
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
              disabled={disabled}
              value={
                draft[field.key] === null
                  ? ''
                  : (draft[field.key] ?? (field.secret ? '' : (field.value ?? '')))
              }
              onChange={(event) => setConfigValue(field.key, event.target.value)}
            />
            {field.set && (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => setConfigValue(field.key, null)}
              >
                {draft[field.key] === null ? t('Will clear') : t('Clear value')}
              </Button>
            )}
          </span>
        </label>
      ))}
      <FlowAlerts manager={manager} />
      <Button
        size="sm"
        disabled={disabled || Object.keys(draft).length === 0}
        onClick={() => void saveConfig()}
      >
        {t('Save')}
      </Button>
    </div>
  );
}

export function NativePluginFlows({
  manager,
  inlineConfig = false,
}: {
  manager: NativePluginManager;
  inlineConfig?: boolean;
}) {
  const { t } = useI18n();
  const { preview, removing, busy, canManage, cancelPreview, cancelUninstall, closeConfig } =
    manager;
  const disabled = !!busy || !canManage;
  return (
    <>
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) void cancelPreview();
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
            <FlowAlerts manager={manager} />
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" disabled={!!busy} onClick={() => void cancelPreview()}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={disabled || !preview}
              onClick={() => preview && void manager.confirmInstall(preview.token)}
            >
              {t('Confirm install')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {!inlineConfig && (
        <Dialog
          open={manager.configuring !== null}
          onOpenChange={(open) => {
            if (!open) closeConfig();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('Configure')}</DialogTitle>
            </DialogHeader>
            <DialogPanel>
              <NativePluginConfigForm manager={manager} />
            </DialogPanel>
            <DialogFooter>
              <Button variant="outline" disabled={!!busy} onClick={closeConfig}>
                {t('Close')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) cancelUninstall();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Uninstall plugin?')}</DialogTitle>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <p>{t('The plugin and its private data will be removed.')}</p>
            <FlowAlerts manager={manager} />
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" disabled={!!busy} onClick={cancelUninstall}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={disabled || !removing}
              onClick={() => removing && void manager.confirmUninstall(removing)}
            >
              {t('Uninstall')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
