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
type Surface = 'chat' | 'pane';
export function DeviceRequest({
  sessionId,
  surface = 'pane',
}: {
  sessionId: string;
  surface?: Surface;
}) {
  const pending = useDeviceAccessEntries(sessionId).filter((entry) => entry.decision === null);
  if (pending.length === 0) return null;
  return (
    <div className="max-h-56 shrink-0 overflow-y-auto" data-device-access-surface={surface}>
      {(surface === 'pane' ? pending.slice(0, 1) : pending).map((entry) => (
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
  const act = async (decision: DeviceAccessDecision) => {
    setBusy(true);
    setError('');
    try {
      await window.electronAPI.devices.answerAccess(entry.sessionId, entry.id, decision);
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
          {t('Allow access to {{name}}?', { name: entry.deviceName })}
        </span>
      </div>
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
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
