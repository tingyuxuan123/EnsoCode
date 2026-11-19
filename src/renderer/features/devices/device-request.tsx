import type { DeviceAccessDecision, DeviceAccessEntry } from '@shared/device-agent';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { useDeviceAccessEntries } from '@/stores/deviceAccess';
import { clockOf, useSeconds } from './support';

const labels = {
  session: 'Allow for this conversation',
  always: 'Always allow this device',
  deny: 'Deny',
} as const;
const outcomes = {
  session: 'Allowed for this conversation',
  always: 'Always allowed this device',
  deny: 'Device access denied',
  timeout: 'Device access request expired',
  revoked: 'Device access revoked',
} as const;

type Surface = 'chat' | 'pane';
export function DeviceRequest({
  sessionId,
  surface = 'pane',
}: {
  sessionId: string;
  surface?: Surface;
}) {
  const entries = useDeviceAccessEntries(sessionId);
  const latest = entries.find((e) => e.decision === null) ?? entries.at(-1);
  if (!latest) return null;
  return (
    <div className="max-h-56 shrink-0 overflow-y-auto" data-device-access-surface={surface}>
      {(surface === 'pane' ? [latest] : entries).map((entry) => (
        <AccessCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function Deadline({ expiresAt }: { expiresAt: number }) {
  const { t } = useI18n();
  const now = useSeconds();
  return (
    <p className="text-xs text-muted-foreground">
      {t('Screenshots go to its model provider. Auto-deny in {{time}}.', {
        time: clockOf(Math.max(0, expiresAt - now)),
      })}
    </p>
  );
}

function AccessCard({ entry }: { entry: DeviceAccessEntry }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = async (decision: DeviceAccessDecision | 'revoke') => {
    setBusy(true);
    setError('');
    try {
      const api = window.electronAPI.devices;
      if (decision === 'revoke') await api.revokeAccess(entry.sessionId, entry.deviceId);
      else await api.answerAccess(entry.sessionId, entry.id, decision);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="border-b border-line/60 bg-warning/8 px-3 py-2 text-sm"
      data-device-entry-id={entry.id}
    >
      <div className="flex items-center gap-1.5">
        <ShieldCheck aria-hidden className="size-4 shrink-0" />
        <span title={entry.deviceId}>
          {entry.decision === null
            ? t('Allow access to {{name}}?', { name: entry.deviceName })
            : `${entry.deviceName} · ${t(outcomes[entry.revoked ? 'revoked' : entry.decision])}`}
        </span>
      </div>
      {entry.decision === null ? (
        <>
          <Deadline expiresAt={entry.expiresAt} />
          <div className="mt-2 flex flex-wrap gap-1">
            {(['deny', 'session', 'always'] as const).map((decision) => (
              <Button
                key={decision}
                variant={decision === 'session' ? 'outline' : 'ghost'}
                size="xs"
                disabled={busy}
                data-device-decision={decision}
                onClick={() => void act(decision)}
              >
                {t(labels[decision])}
              </Button>
            ))}
          </div>
        </>
      ) : entry.decision === 'session' && !entry.revoked ? (
        <Button
          variant="ghost"
          size="xs"
          disabled={busy}
          data-device-decision="revoke"
          onClick={() => void act('revoke')}
        >
          {t('Revoke')}
        </Button>
      ) : null}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
