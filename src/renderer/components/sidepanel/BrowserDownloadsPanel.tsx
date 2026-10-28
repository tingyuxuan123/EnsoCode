import type {
  BrowserDownloadEntry,
  BrowserDownloadRequest,
  BrowserRecordsQuery,
} from '@shared/types/browser';
import { Download, FolderOpen, Pause, Play, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { BrowserRecordsPagination, useBrowserRecords } from './BrowserRecords';
import { browserDownloadProgress, formatBrowserBytes } from './browserUi';

const STATE_LABELS: Record<BrowserDownloadEntry['state'], string> = {
  progressing: 'Downloading…',
  paused: 'Download paused',
  completed: 'Download completed',
  cancelled: 'Download cancelled',
  interrupted: 'Download interrupted',
};

export function BrowserDownloadsPanel({
  open,
  onOpenChange,
  conversationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
}) {
  const { t, locale } = useI18n();
  const load = useCallback(
    (request: BrowserRecordsQuery) => window.electronAPI.browser.downloads(conversationId, request),
    [conversationId]
  );
  const records = useBrowserRecords<BrowserDownloadEntry>(open, conversationId, load);
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = window.electronAPI.browser.onDownloadsChanged((event) => {
      if (event.conversationId !== conversationId || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        void records.refresh();
      }, 250);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [open, conversationId, records.refresh]);
  const action = (id: string, action: BrowserDownloadRequest['action']) =>
    records.run(() => window.electronAPI.browser.downloads(conversationId, { action, id }));
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!records.busy) onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('Browser downloads')}</DialogTitle>
          <DialogDescription>
            {t(
              'Manage downloads for this browser conversation. Removing a record does not delete the downloaded file.'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={records.query}
              onChange={(event) => records.setQuery(event.target.value)}
              placeholder={t('Search downloads by filename or URL')}
              aria-label={t('Search downloads by filename or URL')}
              className="[&_input]:pl-8"
            />
          </div>
          {records.error && (
            <p role="alert" className="break-words text-[calc(11rem/14)] text-destructive">
              {records.error}
            </p>
          )}
          <div aria-busy={records.loading} className="min-h-32 space-y-1">
            {records.loading && records.items.length === 0 && (
              <p role="status" className="py-2 text-[calc(11rem/14)] text-muted-foreground">
                {t('Loading browser records…')}
              </p>
            )}
            {!records.loading && records.items.length === 0 && (
              <div className="rounded-md border border-dashed px-3 py-8 text-center">
                <Download className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-3 font-medium text-sm">{t('No browser downloads')}</p>
                <p className="mt-1 text-[calc(11rem/14)] text-muted-foreground">
                  {t('Files downloaded from web pages will appear here.')}
                </p>
              </div>
            )}
            {records.items.map((item) => {
              const progress = browserDownloadProgress(item.receivedBytes, item.totalBytes);
              const active = item.state === 'progressing' || item.state === 'paused';
              return (
                <div key={item.id} className="rounded-md border border-border/70 p-3">
                  <div className="flex items-start gap-2">
                    <Download className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={item.filename}>
                        {item.filename}
                      </p>
                      <p
                        className="mt-0.5 truncate text-[calc(11rem/14)] text-muted-foreground"
                        title={item.url}
                      >
                        {item.url}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center">
                      {item.state === 'progressing' && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={records.busy}
                          aria-label={t('Pause download')}
                          title={t('Pause download')}
                          onClick={() => void action(item.id, 'pause')}
                        >
                          <Pause className="size-3.5" />
                        </Button>
                      )}
                      {item.state === 'paused' && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={records.busy}
                          aria-label={t('Resume download')}
                          title={t('Resume download')}
                          onClick={() => void action(item.id, 'resume')}
                        >
                          <Play className="size-3.5" />
                        </Button>
                      )}
                      {active && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={records.busy}
                          aria-label={t('Cancel download')}
                          title={t('Cancel download')}
                          onClick={() => void action(item.id, 'cancel')}
                        >
                          <X className="size-3.5" />
                        </Button>
                      )}
                      {item.state === 'completed' && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={records.busy}
                          aria-label={t('Reveal in file manager')}
                          title={t('Reveal in file manager')}
                          onClick={() => void action(item.id, 'reveal')}
                        >
                          <FolderOpen className="size-3.5" />
                        </Button>
                      )}
                      {!active && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={records.busy}
                          aria-label={t('Remove download record')}
                          title={t('Remove download record')}
                          onClick={() => void action(item.id, 'remove')}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span
                      className={cn(
                        item.state === 'interrupted' && 'text-destructive',
                        item.state === 'completed' && 'text-success'
                      )}
                    >
                      {t(STATE_LABELS[item.state])}
                    </span>
                    <span>
                      {formatBrowserBytes(item.receivedBytes)}
                      {item.totalBytes > 0 ? ` / ${formatBrowserBytes(item.totalBytes)}` : ''}
                      {progress !== null ? ` · ${progress}%` : ''}
                    </span>
                    <time className="ml-auto" dateTime={new Date(item.startedAt).toISOString()}>
                      {new Date(item.startedAt).toLocaleString(locale)}
                    </time>
                  </div>
                  {active && (
                    <progress
                      aria-label={t('Download progress')}
                      max={100}
                      value={progress ?? undefined}
                      className="mt-2 block h-1.5 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
                    />
                  )}
                  {item.error && (
                    <p className="mt-2 break-words text-[calc(11rem/14)] text-destructive">
                      {item.error}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </DialogPanel>
        <DialogFooter className="sm:flex-col sm:items-stretch">
          <BrowserRecordsPagination
            offset={records.offset}
            total={records.total}
            disabled={records.loading || records.busy}
            onOffset={records.setOffset}
          />
          <Button
            className="self-end"
            variant="outline"
            size="sm"
            disabled={records.busy}
            onClick={() => onOpenChange(false)}
          >
            {t('Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
