import type { UpdateStatus } from '@shared/types/updater';
import { AlertTriangle, Download, RotateCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n';

/** 主窗口顶部更新横幅:下载完成后提示重启(下载进度用小条,可关闭) */
export function UpdateBanner() {
  const { t } = useI18n();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    return window.electronAPI.updater.onStatus((next) => {
      setStatus(next);
      if (next.status === 'downloaded' || next.status === 'downloading' || next.status === 'error')
        setDismissed(false);
    });
  }, []);

  if (dismissed || !status) return null;
  if (
    status.status !== 'downloaded' &&
    status.status !== 'downloading' &&
    status.status !== 'error'
  )
    return null;

  const version = status.info?.version;
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
              : t('Downloading update… {{percent}}%', {
                  percent: Math.round(status.progress?.percent ?? 0),
                })}
        </span>
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
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          title={t('Close')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
