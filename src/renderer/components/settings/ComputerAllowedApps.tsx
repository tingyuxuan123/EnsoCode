import { appIdentityKey } from '@shared/computer/appIdentity';
import type { ComputerAllowedApp } from '@shared/computer/types';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';

/** Only Main can grant app access. Settings can list or revoke it. */
export function ComputerAllowedApps() {
  const [apps, setApps] = useState<ComputerAllowedApp[] | null>(null);
  const [pending, setPending] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.computer
      .allowedApps()
      .then((list) => {
        if (!cancelled) setApps(list);
      })
      .catch(() => {
        if (!cancelled) setApps([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const revoke = async (key: string) => {
    setPending(key);
    try {
      const result = await window.electronAPI.computer.revokeApp(key);
      if (result.ok) setApps(await window.electronAPI.computer.allowedApps());
    } finally {
      setPending(undefined);
    }
  };
  return (
    <ComputerAllowedAppsList
      apps={apps}
      pending={pending}
      onRevoke={(key) => {
        void revoke(key).catch(() => {});
      }}
    />
  );
}

export function ComputerAllowedAppsList({
  apps,
  pending,
  onRevoke,
}: {
  apps: ComputerAllowedApp[] | null;
  pending?: string;
  onRevoke(key: string): void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2" data-settings-row="tools.computerApps">
      <p className="font-medium text-sm">{t('Apps the AI may control')}</p>
      <p className="text-muted-foreground text-xs">
        {t(
          'The first time the AI clicks or types in an app, 小满 asks you. Apps you always allow are listed here; it can then read everything in their windows.'
        )}
      </p>
      {apps?.length === 0 && (
        <p className="text-muted-foreground text-xs">{t('No apps are always allowed yet.')}</p>
      )}
      {apps && apps.length > 0 && (
        <ul className="divide-y rounded-md border">
          {apps.map((app) => (
            <li
              key={appIdentityKey(app)}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">{app.name}</p>
                <p className="truncate text-muted-foreground text-xs" title={app.path}>
                  {app.path}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={pending !== undefined}
                onClick={() => onRevoke(appIdentityKey(app))}
              >
                {t('Revoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
