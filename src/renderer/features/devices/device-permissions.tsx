import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';

/** Forget affects future conversations; it does not revoke an existing session grant. */
export function DevicePermissions() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const api = window.electronAPI?.devices;
  useEffect(() => {
    if (!open || !api?.allowedAccess) return;
    let live = true;
    let version = 0;
    const refresh = () => {
      const current = ++version;
      void api
        .allowedAccess()
        .then((list) => {
          if (live && current === version) {
            setIds(list);
            setError('');
          }
        })
        .catch((err) => {
          if (live && current === version) setError(String(err));
        });
    };
    const stop = api.onAccessChanged((entry) => {
      if (entry.decision === 'always') refresh();
    });
    refresh();
    return () => {
      live = false;
      stop();
    };
  }, [api, open]);
  if (!api?.allowedAccess) return null;
  return (
    <details
      className="shrink-0 border-t border-line/60 px-2 py-1 text-xs"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-muted-foreground">
        {t('Remembered device permissions')}
      </summary>
      {open && (
        <div className="max-h-28 overflow-y-auto">
          {ids.length === 0 && !error && t('No devices are always allowed.')}
          {ids.map((id) => (
            <div className="flex items-center justify-between gap-2" key={id}>
              <code className="truncate" title={id}>
                {id}
              </code>
              <Button
                variant="ghost"
                size="xs"
                title={t('Forget this permission for future conversations')}
                onClick={() =>
                  void api
                    .forgetAccess(id)
                    .then(() => setIds((current) => current.filter((key) => key !== id)))
                    .catch((err) => setError(String(err)))
                }
              >
                {t('Remove')}
              </Button>
            </div>
          ))}
          {error && <span role="alert">{error}</span>}
        </div>
      )}
    </details>
  );
}
