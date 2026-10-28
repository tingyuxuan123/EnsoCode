import type { BrowserRecordsQuery, BrowserResult } from '@shared/types/browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';

const PAGE_SIZE = 30;

export function useBrowserRecords<T>(
  open: boolean,
  conversationId: string,
  load: (request: BrowserRecordsQuery) => Promise<BrowserResult<{ items: T[]; total: number }>>
) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const generation = useRef(0);
  const actionGeneration = useRef(0);
  useEffect(() => {
    if (!open || !conversationId) return;
    setQuery('');
    setSearch('');
    setOffset(0);
    setItems([]);
    setTotal(0);
    setLoadError(null);
    setActionError(null);
    setBusy(false);
    return () => {
      actionGeneration.current += 1;
    };
  }, [open, conversationId]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setOffset(0);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);
  const refresh = useCallback(async () => {
    if (!open) return;
    const current = ++generation.current;
    setLoading(true);
    try {
      const result = await load({ query: search, offset, limit: PAGE_SIZE });
      if (current !== generation.current) return;
      if (!result.ok) setLoadError(result.error);
      else {
        setItems(result.result.items);
        setTotal(result.result.total);
        setLoadError(null);
        if (offset >= result.result.total && offset > 0)
          setOffset(Math.max(0, Math.ceil(result.result.total / PAGE_SIZE) - 1) * PAGE_SIZE);
      }
    } catch (cause) {
      if (current === generation.current)
        setLoadError(cause instanceof Error ? cause.message : t('Could not load browser records.'));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [open, load, offset, search, t]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);
  const run = async (action: () => Promise<BrowserResult<unknown>>) => {
    const current = ++actionGeneration.current;
    setBusy(true);
    setActionError(null);
    try {
      const result = await action();
      if (current !== actionGeneration.current) return false;
      if (!result.ok) {
        setActionError(result.error);
        return false;
      }
      await refreshRef.current();
      return current === actionGeneration.current;
    } catch (cause) {
      if (current === actionGeneration.current)
        setActionError(cause instanceof Error ? cause.message : t('Browser action failed.'));
      return false;
    } finally {
      if (current === actionGeneration.current) setBusy(false);
    }
  };
  return {
    query,
    setQuery,
    offset,
    setOffset,
    items,
    total,
    loading,
    busy,
    error: actionError ?? loadError,
    refresh,
    run,
  };
}

export function BrowserRecordsPagination({
  offset,
  total,
  disabled,
  onOffset,
}: {
  offset: number;
  total: number;
  disabled: boolean;
  onOffset: (offset: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-auto text-[calc(11rem/14)] text-muted-foreground">
        {t('Page {{page}} of {{pages}} · {{total}} records', {
          page: Math.floor(offset / PAGE_SIZE) + 1,
          pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
          total,
        })}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || offset === 0}
        onClick={() => onOffset(Math.max(0, offset - PAGE_SIZE))}
      >
        {t('Previous page')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || offset + PAGE_SIZE >= total}
        onClick={() => onOffset(offset + PAGE_SIZE)}
      >
        {t('Next page')}
      </Button>
    </div>
  );
}
