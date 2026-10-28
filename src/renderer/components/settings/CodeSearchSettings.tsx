import { parseCodeSearchAccountKey } from '@shared/codeSearch';
import type { OauthAccount } from '@shared/types';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/i18n';
import { useOauthCredentialStore } from '@/stores/oauthCredentials';
import { useSettingsStore } from '@/stores/settings';

/** 只复用现有订阅账号与脱敏展示信息；不另建登录流，也不自动选择或替换账号。 */
export function CodeSearchSettings() {
  const { t } = useI18n();
  const accountKey = useSettingsStore((state) => state.codeSearchAccountKey);
  const setAccountKey = useSettingsStore((state) => state.setCodeSearchAccountKey);
  const snapshot = useOauthCredentialStore((state) => state.snapshot);
  const [loaded, setLoaded] = useState<{
    revision: number;
    accounts: OauthAccount[];
    error: boolean;
  } | null>(null);
  const revision = snapshot.revision;
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.providers.listOauth().then(
      (infos) => {
        if (cancelled) return;
        setLoaded({
          revision,
          accounts: infos
            .flatMap((info) => info.accounts)
            .filter(
              (account) =>
                account.providerId === 'devin' && parseCodeSearchAccountKey(account.key) !== null
            ),
          error: false,
        });
      },
      () => {
        if (!cancelled) setLoaded({ revision, accounts: [], error: true });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [revision]);

  const data = loaded?.revision === revision ? loaded : null;
  const availability = snapshot.availability;
  const accounts =
    availability.status === 'ready'
      ? (data?.accounts ?? []).filter((account) =>
          availability.authenticatedAccountKeys.has(account.key)
        )
      : [];
  const pending = availability.status === 'loading' || availability.status === 'unloaded' || !data;
  const unavailable =
    !pending && accountKey !== null && !accounts.some((account) => account.key === accountKey);
  const labels = Object.fromEntries([
    ['', t('Select a Devin account')],
    ...accounts.map((account) => [account.key, account.email || account.key]),
    ...(accountKey && !accounts.some((account) => account.key === accountKey)
      ? [[accountKey, t('Unavailable Devin account')]]
      : []),
  ]);

  return (
    <div className="space-y-2" data-settings-row="tools.codeSearch">
      <p className="text-muted-foreground text-[calc(12rem/14)]">
        {t(
          "Code search sends queries, directory information and selected code snippets to Devin's cloud. Ordinary code may contain hardcoded secrets; review the workspace before enabling."
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={labels}
          value={accountKey ?? ''}
          disabled={pending || availability.status !== 'ready' || data?.error}
          onValueChange={(key) => {
            if (key === '') setAccountKey(null);
            else if (typeof key === 'string' && accounts.some((account) => account.key === key))
              setAccountKey(key);
          }}
        >
          <SelectTrigger className="w-64" aria-label={t('Code search account')}>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="">{t('Select a Devin account')}</SelectItem>
            {accounts.map((account) => (
              <SelectItem key={account.key} value={account.key}>
                {account.email || account.key}
              </SelectItem>
            ))}
            {accountKey && !accounts.some((account) => account.key === accountKey) && (
              <SelectItem value={accountKey} disabled>
                {t('Unavailable Devin account')}
              </SelectItem>
            )}
          </SelectPopup>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void window.electronAPI.window.openSettings({
              category: 'providers',
              rowId: 'providers.root',
            })
          }
        >
          {t('Manage subscriptions')}
        </Button>
      </div>
      {pending ? (
        <p className="text-muted-foreground text-[calc(12rem/14)]">{t('Loading…')}</p>
      ) : data?.error || availability.status !== 'ready' ? (
        <p className="text-destructive text-[calc(12rem/14)]" role="status">
          {t('Could not load Devin accounts. Open subscription settings and try again.')}
        </p>
      ) : unavailable ? (
        <p className="text-destructive text-[calc(12rem/14)]" role="status">
          {t(
            'The selected Devin account is unavailable. Code search will not switch accounts automatically. Select an account or sign in again in subscription settings.'
          )}
        </p>
      ) : accounts.length === 0 ? (
        <p className="text-muted-foreground text-[calc(12rem/14)]">
          {t('No signed-in Devin accounts. Use the existing subscription settings to sign in.')}
        </p>
      ) : null}
      <p className="text-muted-foreground text-[calc(12rem/14)]">
        {t(
          'The code search tool switch takes effect in new conversations. Account selection stays on this device.'
        )}
      </p>
    </div>
  );
}
