import type { MemoryNoteSummary } from '@shared/memory/dto';
import { ExternalLink, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';

/** 某个记忆空间（bot:<id> / chat:<id>）的 Wiki 笔记列表，可逐条编辑、打开或删除 */
export function MemorySpaceList({ spaceId, emptyText }: { spaceId: string; emptyText: string }) {
  const [items, setItems] = useState<MemoryNoteSummary[] | null>(null);

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

function MemoryRow({ item, onDeleted }: { item: MemoryNoteSummary; onDeleted: () => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const startEdit = async () => {
    setBusy(true);
    const detail = await window.electronAPI.memory.detail(item.id);
    setBusy(false);
    if (detail) setDraft({ title: detail.title, body: detail.body });
    else addToast({ type: 'error', title: t('Memory not found') });
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const result = await window.electronAPI.memory.update(item.id, {
      title: draft.title,
      body: draft.body,
    });
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
          value={draft.body}
          placeholder={t('Memory content')}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
        />
        <div className="flex justify-end gap-1.5">
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
            {t('Cancel')}
          </Button>
          <Button size="xs" disabled={busy || !draft.body.trim()} onClick={() => void save()}>
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
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-[calc(11rem/14)]">{item.title}</span>
          <Badge variant="secondary" size="sm">
            {item.type}
          </Badge>
          {item.status === 'draft' && (
            <Badge variant="outline" size="sm">
              {t('Draft')}
            </Badge>
          )}
        </div>
        {item.description && (
          <div className="line-clamp-2 text-muted-foreground text-[calc(11rem/14)]">
            {item.description}
          </div>
        )}
      </div>
      <div className="flex shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          title={t('Open in Obsidian')}
          aria-label={t('Open in Obsidian')}
          onClick={() =>
            void window.electronAPI.memory.openVault({ noteId: item.id, app: 'obsidian' })
          }
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
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
