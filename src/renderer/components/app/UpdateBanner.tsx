import type { UpdateStatus } from '@shared/types/updater';
import { AlertTriangle, Download, RotateCw, X } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settings';
import { ReleaseNotesDialog } from './ReleaseNotesDialog';
import { useUpdateStatus } from './UpdateBannerState';

/** 主窗口更新状态；日志仅来自当前订阅，关闭自动更新后仍可手动下载。 */
export function UpdateBanner() {
  const { t } = useI18n();
  const autoUpdate = useSettingsStore((state) => state.autoUpdate);
  const { status, notes, download, downloadPending, canShowNotes, showNotes, closeNotes } =
    useUpdateStatus();
  const [dismissed, setDismissed] = useState<UpdateStatus | null>(null);

  if (!status || status === dismissed) return null;
  if (
    status.status !== 'available' &&
    status.status !== 'downloaded' &&
    status.status !== 'downloading' &&
    status.status !== 'error'
  )
    return null;

  const version = status.info?.version;
  const isAvailable = status.status === 'available';
  const isDownloaded = status.status === 'downloaded';
  const isError = status.status === 'error';

  return (
    <div className="border-b border-primary/20 bg-background">
      <div className="flex items-center gap-2 bg-primary/8 px-4 py-1.5 text-[calc(12rem/14)]">
        {isError ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
        ) : isDownloaded ? (
          <RotateCw className="h-3.5 w-3.5 shrink-0 text-primary" />
        ) : (
          <Download className="h-3.5 w-3.5 shrink-0 animate-pulse text-primary" />
        )}
        <span className="min-w-0 flex-1 break-words">
          {isError
            ? `${t('Update failed')}${status.error ? `: ${status.error}` : ''}`
            : isDownloaded
              ? t('New version {{version}} is ready — restart to update.', {
                  version: version ?? '',
                })
              : isAvailable
                ? t('New version {{version}} found', { version: version ?? '' })
                : t('Downloading update… {{percent}}%', {
                    percent: Math.round(status.progress?.percent ?? 0),
                  })}
        </span>
        {canShowNotes && (
          <button
            type="button"
            onClick={showNotes}
            className="shrink-0 rounded-md px-2.5 py-1 text-primary hover:bg-primary/10"
          >
            {t('Release notes')}
          </button>
        )}
        {isAvailable && !autoUpdate && (
          <button
            type="button"
            disabled={downloadPending}
            onClick={() => void download()}
            className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {t('Download')}
          </button>
        )}
        {isDownloaded && (
          <button
            type="button"
            onClick={() => void window.electronAPI.updater.quitAndInstall()}
            className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t('Restart to update')}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            closeNotes();
            setDismissed(status);
          }}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          title={t('Close')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ReleaseNotesDialog info={isError ? null : notes} onClose={closeNotes} />
    </div>
  );
}
