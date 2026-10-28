import type { BrowserHistoryEntry, BrowserRecordsQuery } from '@shared/types/browser';
import { ExternalLink, History, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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
import { BrowserRecordsPagination, useBrowserRecords } from './BrowserRecords';

export function BrowserHistoryPanel({
  open,
  onOpenChange,
  conversationId,
  onNavigate,
  navigationDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  onNavigate: (url: string) => Promise<boolean>;
  navigationDisabled: boolean;
}) {
  const { t, locale } = useI18n();
  const load = useCallback(
    (request: BrowserRecordsQuery) => window.electronAPI.browser.history(conversationId, request),
    [conversationId]
  );
  const records = useBrowserRecords<BrowserHistoryEntry>(open, conversationId, load);
  const [confirmClear, setConfirmClear] = useState(false);
  const [opening, setOpening] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) setConfirmClear(false);
    setNavigationError(null);
  }, [open]);
  const navigate = async (url: string) => {
    setOpening(true);
    setNavigationError(null);
    try {
      if (await onNavigate(url)) onOpenChange(false);
      else setNavigationError(t('Navigation failed'));
    } catch (cause) {
      setNavigationError(cause instanceof Error ? cause.message : t('Navigation failed'));
    } finally {
      setOpening(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!records.busy && !opening) onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('Browsing history')}</DialogTitle>
          <DialogDescription>
            {t(
              'History for this browser conversation. Clearing records does not clear cookies or sign you out.'
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
              placeholder={t('Search history by title or URL')}
              aria-label={t('Search history by title or URL')}
              className="[&_input]:pl-8"
            />
          </div>
          {(records.error || navigationError) && (
            <p role="alert" className="break-words text-[calc(11rem/14)] text-destructive">
              {navigationError ?? records.error}
            </p>
          )}
          <div aria-busy={records.loading} className="min-h-32">
            {records.loading && (
              <p role="status" className="py-2 text-[calc(11rem/14)] text-muted-foreground">
                {t('Loading browser records…')}
              </p>
            )}
            {!records.loading && records.items.length === 0 && (
              <div className="rounded-md border border-dashed px-3 py-8 text-center">
                <History className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">{t('No browsing history')}</p>
                <p className="mt-1 text-[calc(11rem/14)] text-muted-foreground">
                  {t(
                    'Pages you visit will appear here. Try another search if records are filtered.'
                  )}
                </p>
              </div>
            )}
            {records.items.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-accent/50"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left disabled:opacity-60"
                  disabled={navigationDisabled || opening || records.busy}
                  onClick={() => void navigate(item.url)}
                  title={item.url}
                >
                  <span className="block truncate text-sm font-medium">
                    {item.title || item.url}
                  </span>
                  <span className="mt-0.5 block truncate text-[calc(11rem/14)] text-muted-foreground">
                    {item.url}
                  </span>
                  <time
                    className="mt-1 block text-[11px] text-muted-foreground"
                    dateTime={new Date(item.visitedAt).toISOString()}
                  >
                    {new Date(item.visitedAt).toLocaleString(locale)}
                  </time>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('Open history page')}
                  title={t('Open history page')}
                  disabled={navigationDisabled || opening || records.busy}
                  onClick={() => void navigate(item.url)}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('Remove history record')}
                  title={t('Remove history record')}
                  disabled={records.busy}
                  onClick={() =>
                    void records.run(() =>
                      window.electronAPI.browser.history(conversationId, {
                        action: 'remove',
                        id: item.id,
                      })
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
          {navigationDisabled && (
            <p className="text-[calc(11rem/14)] text-warning">
              {t('Take control before opening a history page.')}
            </p>
          )}
          {confirmClear && (
            <div className="space-y-3 rounded-md border border-destructive/32 bg-destructive/8 p-3">
              <p className="text-sm text-destructive">
                {t(
                  'Clear all history for this conversation? This permanently removes the visit records, not cookies or downloaded files.'
                )}
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={records.busy}
                  onClick={() => setConfirmClear(false)}
                >
                  {t('Cancel')}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={records.busy}
                  onClick={() =>
                    void records
                      .run(() =>
                        window.electronAPI.browser.history(conversationId, { action: 'clear' })
                      )
                      .then((ok) => {
                        if (ok) setConfirmClear(false);
                      })
                  }
                >
                  {t('Clear all history')}
                </Button>
              </div>
            </div>
          )}
        </DialogPanel>
        <DialogFooter className="sm:flex-col sm:items-stretch">
          <BrowserRecordsPagination
            offset={records.offset}
            total={records.total}
            disabled={records.loading || records.busy}
            onOffset={records.setOffset}
          />
          <div className="flex justify-between gap-2">
            <Button
              variant="destructive-outline"
              size="sm"
              disabled={records.total === 0 || records.busy}
              onClick={() => setConfirmClear(true)}
            >
              {t('Clear all history')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={records.busy || opening}
            >
              {t('Close')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
