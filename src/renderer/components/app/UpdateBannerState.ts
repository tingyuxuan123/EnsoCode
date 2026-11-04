import type { UpdateStatus } from '@shared/types/updater';
import { useEffect, useState } from 'react';

export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [notes, setNotes] = useState<{ version: string; releaseNotes: string } | null>(null);
  const [downloadPending, setDownloadPending] = useState(false);

  useEffect(() => window.electronAPI.updater.onStatus(setStatus), []);
  useEffect(() => {
    if (
      status?.status === 'checking' ||
      status?.status === 'error' ||
      status?.status === 'not-available'
    ) {
      setNotes(null);
    }
  }, [status?.status]);

  const info =
    status?.status === 'available' || status?.status === 'downloaded' ? status.info : undefined;

  const download = async () => {
    if (downloadPending || status?.status !== 'available') return;
    setDownloadPending(true);
    try {
      await window.electronAPI.updater.downloadUpdate();
    } catch (error) {
      // Main normally broadcasts the failure first. Do not overwrite a newer status.
      setStatus((current) =>
        current === status
          ? { status: 'error', error: error instanceof Error ? error.message : String(error) }
          : current
      );
    } finally {
      setDownloadPending(false);
    }
  };

  return {
    status,
    download,
    downloadPending,
    notes,
    canShowNotes: Boolean(info?.releaseNotes),
    showNotes: () => {
      if (info?.releaseNotes) setNotes({ version: info.version, releaseNotes: info.releaseNotes });
    },
    closeNotes: () => setNotes(null),
  };
}
