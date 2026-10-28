import type { MemoryListItem } from '@shared/memory/dto';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';

/** 某个记忆空间（bot:<id> / chat:<id>）的条目列表，可逐条编辑、删除 */
export function MemorySpaceList({ spaceId, emptyText }: { spaceId: string; emptyText: string }) {
  const [items, setItems] = useState<MemoryListItem[] | null>(null);

  const load = useCallback(async () => {
    const result = await window.electronAPI.memory.list({ spaceId, limit: 100, offset: 0 });
    setItems(result.items);
  }, [spaceId]);

  useEffect(() => {
    setItems(null);
    void load();
    return window.electronAPI.memory.onChanged(() => void load());
  }, [load]);

  if (items === null) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (items.length === 0)
    return <p className="text-muted-foreground text-[calc(11rem/14)]">{emptyText}</p>;
  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <MemoryRow
          key={item.id}
          item={item}
          onDeleted={() =>
            setItems((list) => list?.filter((entry) => entry.id !== item.id) ?? null)
          }
        />
      ))}
    </div>
  );
}

function MemoryRow({ item, onDeleted }: { item: MemoryListItem; onDeleted: () => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<{ title: string; content: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // 列表只带摘要，编辑要拿全文
  const startEdit = async () => {
    setBusy(true);
    const detail = await window.electronAPI.memory.detail(item.id);
    setBusy(false);
    if (detail) setDraft({ title: detail.title, content: detail.content });
    else addToast({ type: 'error', title: t('Memory not found') });
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const result = await window.electronAPI.memory.update(item.id, draft);
    setBusy(false);
    if (result.ok) setDraft(null);
    else addToast({ type: 'error', title: t('Save failed'), description: result.error });
  };

  if (draft) {
    return (
      <div data-slot="bot-card" className="space-y-1.5 rounded-md border bg-card px-2.5 py-2">
        <Input
          size="sm"
          value={draft.title}
          placeholder={t('Memory title')}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
        <Textarea
          rows={5}
          value={draft.content}
          placeholder={t('Memory content')}
          onChange={(event) => setDraft({ ...draft, content: event.target.value })}
        />
        <div className="flex justify-end gap-1.5">
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
            {t('Cancel')}
          </Button>
          <Button size="xs" disabled={busy || !draft.content.trim()} onClick={() => void save()}>
            {busy && <Loader2 className="animate-spin" />}
            {t('Save')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-slot="bot-card"
      className="group flex items-start gap-2 rounded-md border bg-card px-2.5 py-2"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-[calc(11rem/14)]">{item.title}</div>
        <div className="line-clamp-3 text-muted-foreground text-[calc(11rem/14)]">
          {item.contentSummary}
        </div>
      </div>
      <div className="flex shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          title={t('Edit')}
          aria-label={t('Edit')}
          disabled={busy}
          onClick={() => void startEdit()}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Pencil className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          title={t('Delete')}
          aria-label={t('Delete')}
          onClick={() =>
            void window.electronAPI.memory.delete(item.id).then((result) => {
              if (result.ok) onDeleted();
              else addToast({ type: 'error', title: result.error ?? t('Delete failed') });
            })
          }
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
