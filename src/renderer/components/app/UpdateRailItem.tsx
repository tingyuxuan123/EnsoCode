import type { UpdateStatus } from '@shared/types/updater';
import { AlertTriangle, Download, RotateCw, X } from 'lucide-react';
import { useState } from 'react';
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { ReleaseNotesDialog } from './ReleaseNotesDialog';
import { useUpdateStatus } from './UpdateBannerState';

const RAIL_BUTTON =
  'relative flex size-[36px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** 下载中的圆环：装饰性，百分比由按钮的 aria-label 表达，弧长按 progress 画。 */
function ProgressRing({ percent }: { percent: number }) {
  const arc = Math.max(0, Math.min(100, percent));
  return (
    <svg
      data-slot="update-progress"
      aria-hidden="true"
      viewBox="0 0 36 36"
      className="pointer-events-none absolute inset-0 size-full -rotate-90"
    >
      <circle
        cx="18"
        cy="18"
        r="16"
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.16}
        strokeWidth={1.5}
      />
      <circle
        cx="18"
        cy="18"
        r="16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${arc} 100`}
      />
    </svg>
  );
}

/**
 * 图标轨上的更新入口（主窗口）：下载中在按钮上画一圈进度，不再用顶部整条横幅撑开工作区。
 * 点开是同一套动作——更新日志、手动下载、重启以更新、关闭——日志仅来自当前订阅；
 * 关闭自动更新后仍可手动下载。状态见 `useUpdateStatus`。
 */
export function UpdateRailItem() {
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
  const isDownloading = status.status === 'downloading';
  const isError = status.status === 'error';
  const percent = Math.round(status.progress?.percent ?? 0);
  const label = isError
    ? `${t('Update failed')}${status.error ? `: ${status.error}` : ''}`
    : isDownloaded
      ? t('New version {{version}} is ready — restart to update.', { version: version ?? '' })
      : isAvailable
        ? t('New version {{version}} found', { version: version ?? '' })
        : t('Downloading update… {{percent}}%', { percent });

  const showDownloadAction = isAvailable && !autoUpdate;
  const hasActions = canShowNotes || showDownloadAction || isDownloaded;

  return (
    <>
      <Popover>
        <PopoverTrigger
          data-slot="update-rail"
          aria-label={label}
          title={label}
          className={cn(
            RAIL_BUTTON,
            isError ? 'text-destructive' : isDownloading ? 'text-foreground' : 'text-brand'
          )}
        >
          {isError ? (
            <AlertTriangle className="size-[19px]" />
          ) : isDownloaded ? (
            <RotateCw className="size-[19px]" />
          ) : (
            <Download className={cn('size-[19px]', isDownloading && 'opacity-80')} />
          )}
          {isDownloading && <ProgressRing percent={percent} />}
        </PopoverTrigger>
        <PopoverPopup
          side="right"
          align="end"
          className="w-[300px] shadow-float [&_[data-slot=popover-viewport]]:p-3"
        >
          <div className="flex items-start gap-2.5 text-[calc(12rem/14)]">
            {isError ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            ) : isDownloaded ? (
              <RotateCw className="mt-0.5 size-4 shrink-0 text-brand" />
            ) : (
              <Download className="mt-0.5 size-4 shrink-0 text-brand" />
            )}
            <span className="min-w-0 flex-1 break-words text-popover-foreground leading-snug">
              {label}
            </span>
            <button
              type="button"
              onClick={() => {
                closeNotes();
                setDismissed(status);
              }}
              title={t('Close')}
              aria-label={t('Close')}
              className="-mt-0.5 -mr-1 shrink-0 rounded-[5px] p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
          {hasActions && (
            <div data-slot="update-actions" className="mt-3 flex items-center justify-end gap-1.5">
              {canShowNotes && (
                <button
                  type="button"
                  onClick={showNotes}
                  className="shrink-0 rounded-[5px] border border-border/80 bg-transparent px-2.5 py-1 font-medium text-[calc(12rem/14)] text-foreground/85 transition-colors hover:bg-accent hover:text-foreground"
                >
                  {t('Release notes')}
                </button>
              )}
              {showDownloadAction && (
                <button
                  type="button"
                  disabled={downloadPending}
                  onClick={() => void download()}
                  className="shrink-0 rounded-[5px] bg-primary px-2.5 py-1 font-medium text-[calc(12rem/14)] text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {t('Download')}
                </button>
              )}
              {isDownloaded && (
                <button
                  type="button"
                  onClick={() => void window.electronAPI.updater.quitAndInstall()}
                  className="shrink-0 rounded-[5px] bg-primary px-2.5 py-1 font-medium text-[calc(12rem/14)] text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  {t('Restart to update')}
                </button>
              )}
            </div>
          )}
        </PopoverPopup>
      </Popover>
      <ReleaseNotesDialog info={isError ? null : notes} onClose={closeNotes} />
    </>
  );
}
