import type { NoteStatus } from '@shared/memory/constants';
import type {
  MemoryListResult,
  MemoryNoteDetail,
  MemoryNoteSummary,
  PendingMemoryWriteDto,
  VaultSpaceDto,
} from '@shared/memory/dto';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupInput } from '@/components/ui/input-group';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { usePendingMemoryWrites, usePendingMemoryWritesStore } from '@/stores/memoryReview';

export const MEMORY_PAGE_SIZE = 25;
const ALL = '__all__';

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function isPristineEmpty(libraryHasRows: boolean | null, hasFilters: boolean): boolean {
  return libraryHasRows === false && !hasFilters;
}

export type MemoryEmptyReason = 'library-empty' | 'no-match';

export function emptyReason(
  libraryHasRows: boolean | null,
  hasFilters: boolean
): MemoryEmptyReason {
  return isPristineEmpty(libraryHasRows, hasFilters) ? 'library-empty' : 'no-match';
}

function statusLabelKey(status: NoteStatus): string {
  if (status === 'verified') return 'Verified';
  if (status === 'draft') return 'Draft';
  return 'Deprecated';
}

export function MemoryRows({
  items,
  onOpen,
  t,
  selected,
  onToggle,
  emptyLabel,
}: {
  items: MemoryNoteSummary[];
  onOpen: (id: string) => void;
  t: (key: string, params?: Record<string, string>) => string;
  selected?: ReadonlySet<string>;
  onToggle?: (id: string) => void;
  emptyLabel?: string;
}) {
  return (
    <ul className="divide-y rounded-[6px] border">
      {items.length === 0 && (
        <li className="px-3 py-6 text-[calc(13rem/14)] text-muted-foreground">{emptyLabel}</li>
      )}
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-2 px-3 py-2">
          {onToggle && (
            <Checkbox
              checked={selected?.has(item.id) ?? false}
              onCheckedChange={() => onToggle(item.id)}
              aria-label={t('Select memory')}
            />
          )}
          <button
            type="button"
            onClick={() => onOpen(item.id)}
            className="min-w-0 flex-1 space-y-0.5 text-left"
          >
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="truncate font-medium text-[calc(13rem/14)]">{item.title}</span>
              <Badge variant="secondary">{item.type}</Badge>
              <Badge variant={item.status === 'verified' ? 'default' : 'outline'}>
                {t(statusLabelKey(item.status))}
              </Badge>
              {item.isRaw && <Badge variant="outline">raw</Badge>}
              {item.isArchived && <Badge variant="outline">{t('Archived')}</Badge>}
            </span>
            <span className="block truncate font-mono text-muted-foreground text-[calc(11rem/14)]">
              [[{item.slug}]] · ↗ {item.outboundCount} · ↙ {item.inboundCount}
            </span>
            {item.description && (
              <span className="line-clamp-2 text-muted-foreground text-[calc(12rem/14)]">
                {item.description}
              </span>
            )}
            <span className="block text-muted-foreground text-[calc(12rem/14)]">
              {formatDate(item.updatedAt)} · {item.spaceLabel}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 待审批写入（Bot 写共享空间）：批准后才写入对应 Markdown Vault */
export function PendingWritesSection({
  writes,
  onReview,
  t,
  busyId,
  error,
}: {
  writes: PendingMemoryWriteDto[];
  onReview: (id: string, decision: 'approve' | 'reject') => void;
  t: (key: string) => string;
  busyId?: string | null;
  error?: string | null;
}) {
  if (writes.length === 0) return null;
  return (
    <section className="space-y-2" data-settings-row="memory.pending-writes">
      <h3 className="text-[calc(14rem/14)] font-medium">{t('Memory writes awaiting approval')}</h3>
      <p className="text-[calc(12rem/14)] text-muted-foreground">
        {t('Suggestions are not written to the vault until you approve them.')}
      </p>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {t(error)}
        </p>
      )}
      {writes.map((write) => (
        <div key={write.id} className="space-y-1 rounded-[6px] border px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-[calc(12rem/14)] text-muted-foreground">
            <span>→ {write.spaceLabel}</span>
            <Badge variant="secondary">{write.type}</Badge>
            <span className="font-mono text-[calc(11rem/14)]">[[{write.slug}]]</span>
            {write.redacted && <span>· {t('Secrets redacted')}</span>}
          </div>
          <div className="text-[calc(13rem/14)] font-medium">{write.title}</div>
          <p className="whitespace-pre-wrap text-[calc(12rem/14)]">{write.proposedBody}</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!!busyId}
              onClick={() => onReview(write.id, 'approve')}
            >
              {t('Approve')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!!busyId}
              onClick={() => onReview(write.id, 'reject')}
            >
              {t('Reject')}
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}

function PendingWritesReview({ t }: { t: (key: string) => string }) {
  const writes = usePendingMemoryWrites();
  const review = usePendingMemoryWritesStore((s) => s.review);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <PendingWritesSection
      writes={writes}
      t={t}
      busyId={busyId}
      error={error}
      onReview={(id, decision) => {
        setBusyId(id);
        setError(null);
        void review(id, decision)
          .then((result) => {
            if (!result.ok) setError(result.error ?? 'Failed');
          })
          .catch(() => setError('Failed'))
          .finally(() => setBusyId(null));
      }}
    />
  );
}

export function MemoryLibrary({ revision = 0 }: { revision?: number } = {}) {
  const { t } = useI18n();
  const [query, setQuery] = React.useState('');
  const [spaceId, setSpaceId] = React.useState<string>(ALL);
  const [noteType, setNoteType] = React.useState<string>(ALL);
  const [statusFilter, setStatusFilter] = React.useState<string>(ALL);
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const [includeRaw, setIncludeRaw] = React.useState(false);
  const [offset, setOffset] = React.useState(0);
  const [items, setItems] = React.useState<MemoryNoteSummary[]>([]);
  const [total, setTotal] = React.useState(0);
  const [availableTypes, setAvailableTypes] = React.useState<string[]>([]);
  const [spaces, setSpaces] = React.useState<VaultSpaceDto[]>([]);
  const [libraryExists, setLibraryExists] = React.useState<boolean | null>(null);
  const [detail, setDetail] = React.useState<MemoryNoteDetail | null>(null);
  const [editor, setEditor] = React.useState<{
    title: string;
    type: string;
    description: string;
    status: NoteStatus;
    tags: string;
    staleAfter: string;
    body: string;
  } | null>(null);
  const [creating, setCreating] = React.useState<{
    spaceId: string;
    title: string;
    type: string;
    description: string;
    tags: string;
    body: string;
  } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const mounted = React.useRef(false);
  const listRequest = React.useRef(0);
  const detailRequest = React.useRef(0);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listRequest.current++;
      detailRequest.current++;
    };
  }, []);

  const reload = React.useCallback(() => {
    if (!mounted.current) return;
    const request = ++listRequest.current;
    const isCurrent = () => mounted.current && request === listRequest.current;

    void window.electronAPI.memory
      .list({
        query: query.trim() || undefined,
        spaceId: spaceId === ALL ? undefined : spaceId,
        type: noteType === ALL ? undefined : noteType,
        status: statusFilter === ALL ? undefined : (statusFilter as NoteStatus),
        includeArchived,
        includeRaw,
        limit: MEMORY_PAGE_SIZE,
        offset,
      })
      .then((result: MemoryListResult) => {
        if (!isCurrent()) return;
        setItems(result.items);
        setTotal(result.total);
        setAvailableTypes(result.types);
      });

    void window.electronAPI.memory.stats().then((stats) => {
      if (!mounted.current) return;
      setSpaces(stats.spaces);
      setLibraryExists(stats.totalNotes + stats.archivedCount > 0);
    });
  }, [query, spaceId, noteType, statusFilter, includeArchived, includeRaw, offset]);

  React.useEffect(() => {
    reload();
    return () => {
      listRequest.current++;
    };
  }, [reload]);

  const reloadRef = React.useRef(reload);
  reloadRef.current = reload;
  React.useEffect(() => window.electronAPI.memory.onChanged(() => reloadRef.current()), []);

  const seenRevision = React.useRef(revision);
  React.useEffect(() => {
    if (seenRevision.current === revision) return;
    seenRevision.current = revision;
    reload();
  }, [revision, reload]);

  const openDetail = (id: string) => {
    const request = ++detailRequest.current;
    void window.electronAPI.memory.detail(id).then((result) => {
      if (mounted.current && request === detailRequest.current) {
        setDetail(result);
        setEditor(
          result
            ? {
                title: result.title,
                type: result.type,
                description: result.description,
                status: result.status,
                tags: result.tags.join(', '),
                staleAfter: result.staleAfter ?? '',
                body: result.body,
              }
            : null
        );
      }
    });
  };

  const closeDetail = () => {
    detailRequest.current++;
    setDetail(null);
    setEditor(null);
  };

  const saveEdit = async () => {
    if (!detail || !editor) return;
    setBusy(true);
    try {
      const tags = editor.tags
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await window.electronAPI.memory.update(detail.id, {
        title: editor.title,
        type: editor.type,
        description: editor.description,
        status: editor.status,
        tags,
        staleAfter: editor.staleAfter.trim() || null,
        body: editor.body,
      });
      if (res.ok && res.note) {
        setDetail(res.note);
        addToast({ type: 'success', title: t('Saved') });
        reloadRef.current();
      } else {
        addToast({ type: 'error', title: t('Save failed'), description: res.error });
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const verifyDetail = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await window.electronAPI.memory.update(detail.id, { status: 'verified' });
      if (res.ok && res.note) {
        setDetail(res.note);
        setEditor((curr) => (curr ? { ...curr, status: 'verified' } : curr));
        reloadRef.current();
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const createNote = async () => {
    if (!creating?.title.trim()) return;
    setBusy(true);
    try {
      const res = await window.electronAPI.memory.create({
        spaceId: creating.spaceId,
        title: creating.title.trim(),
        type: creating.type.trim() || 'notes',
        description: creating.description.trim() || undefined,
        tags: creating.tags
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        body: creating.body,
      });
      if (res.ok) {
        setCreating(null);
        reloadRef.current();
      } else {
        addToast({ type: 'error', title: t('Create failed'), description: res.error });
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const bulkRun = async (run: (id: string) => Promise<unknown>) => {
    setBusy(true);
    try {
      for (const id of selected) await run(id);
    } finally {
      if (mounted.current) {
        setBusy(false);
        setSelected(new Set());
        setConfirmBulkDelete(false);
        reloadRef.current();
      }
    }
  };

  const runMutation = (action: Promise<{ ok: boolean }>) => {
    void action.then(() => {
      if (!mounted.current) return;
      closeDetail();
      setConfirmDeleteId(null);
      reloadRef.current();
    });
  };

  const hasFilters =
    query.trim() !== '' ||
    spaceId !== ALL ||
    noteType !== ALL ||
    statusFilter !== ALL ||
    includeArchived ||
    includeRaw;

  const spaceItems = [
    { value: ALL, label: t('All spaces') },
    ...spaces.map((space) => ({ value: space.spaceId, label: space.label })),
  ];
  const typeItems = [
    { value: ALL, label: t('All types') },
    ...availableTypes.map((type) => ({ value: type, label: type })),
  ];
  const statusItems = [
    { value: ALL, label: t('All statuses') },
    { value: 'verified', label: t('Verified') },
    { value: 'draft', label: t('Draft') },
    { value: 'deprecated', label: t('Deprecated') },
  ];

  return (
    <div className="space-y-4" data-settings-row="memory.library">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[calc(14rem/14)] font-medium">{t('Wiki notes')}</h3>
          <p className="text-[calc(12rem/14)] text-muted-foreground">
            {t('Browse, edit, verify, or open Markdown notes directly in Obsidian.')}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setCreating({
              spaceId: spaceId !== ALL ? spaceId : (spaces[0]?.spaceId ?? 'global'),
              title: '',
              type: 'notes',
              description: '',
              tags: '',
              body: '',
            })
          }
        >
          {t('New note')}
        </Button>
      </div>

      <PendingWritesReview t={t} />

      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:w-72" data-size="sm">
          <InputGroupInput
            value={query}
            placeholder={t('Search wiki notes')}
            onChange={(event) => {
              setOffset(0);
              setQuery(event.target.value);
            }}
          />
        </InputGroup>
        <Select
          value={spaceId}
          items={spaceItems}
          onValueChange={(value) => {
            setOffset(0);
            setSpaceId(String(value));
          }}
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {spaceItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          value={noteType}
          items={typeItems}
          onValueChange={(value) => {
            setOffset(0);
            setNoteType(String(value));
          }}
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {typeItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          value={statusFilter}
          items={statusItems}
          onValueChange={(value) => {
            setOffset(0);
            setStatusFilter(String(value));
          }}
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {statusItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <label className="flex items-center gap-1.5 text-muted-foreground text-[calc(12rem/14)]">
          <Switch
            checked={includeArchived}
            onCheckedChange={(value) => {
              setOffset(0);
              setIncludeArchived(value === true);
            }}
          />
          {t('Show archived')}
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground text-[calc(12rem/14)]">
          <Switch
            checked={includeRaw}
            onCheckedChange={(value) => {
              setOffset(0);
              setIncludeRaw(value === true);
            }}
          />
          {t('Show raw')}
        </label>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-[6px] border border-selection-border bg-selection px-3 py-2 text-selection-foreground">
          <span className="text-[calc(13rem/14)]">
            {t('{{count}} selected', { count: String(selected.size) })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setSelected(new Set())}
            >
              {t('Clear selection')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void bulkRun((id) => window.electronAPI.memory.archive(id))}
            >
              {t('Archive selected')}
            </Button>
            <button
              type="button"
              disabled={busy}
              className="text-[calc(12rem/14)] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
              onClick={() => setConfirmBulkDelete(true)}
            >
              {t('Delete permanently')}
            </button>
          </div>
        </div>
      )}

      <MemoryRows
        items={items}
        onOpen={openDetail}
        t={t}
        selected={selected}
        emptyLabel={
          {
            'library-empty': t(
              'No wiki notes yet. They appear here once the agent or you create one.'
            ),
            'no-match': t('No notes match these filters.'),
          }[emptyReason(libraryExists, hasFilters)]
        }
        onToggle={(id) => {
          const next = new Set(selected);
          if (!next.delete(id)) next.add(id);
          setSelected(next);
        }}
      />

      {total > MEMORY_PAGE_SIZE && (
        <div className="flex items-center justify-between text-[calc(12rem/14)] text-muted-foreground">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - MEMORY_PAGE_SIZE))}
          >
            {t('Previous')}
          </Button>
          <span>
            {offset + 1}–{Math.min(offset + MEMORY_PAGE_SIZE, total)} / {total}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + MEMORY_PAGE_SIZE >= total}
            onClick={() => setOffset(offset + MEMORY_PAGE_SIZE)}
          >
            {t('Next')}
          </Button>
        </div>
      )}

      <Dialog open={detail !== null} onOpenChange={(open) => !open && closeDetail()}>
        <DialogContent className="sm:max-w-2xl">
          {detail && editor && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.title}</DialogTitle>
                <DialogDescription>
                  [[{detail.slug}]] · {detail.spaceLabel} · {formatDate(detail.updatedAt)}
                </DialogDescription>
              </DialogHeader>

              <DialogPanel className="space-y-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="space-y-1 text-[calc(12rem/14)]">
                    <span className="text-muted-foreground">{t('Title')}</span>
                    <Input
                      size="sm"
                      value={editor.title}
                      onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                    />
                  </label>
                  <label className="space-y-1 text-[calc(12rem/14)]">
                    <span className="text-muted-foreground">{t('Category')}</span>
                    <Input
                      size="sm"
                      value={editor.type}
                      onChange={(e) => setEditor({ ...editor, type: e.target.value })}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="space-y-1 text-[calc(12rem/14)]">
                    <span className="text-muted-foreground">{t('Summary')}</span>
                    <Input
                      size="sm"
                      value={editor.description}
                      onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                    />
                  </label>
                  <label className="space-y-1 text-[calc(12rem/14)]">
                    <span className="text-muted-foreground">{t('Tags')}</span>
                    <Input
                      size="sm"
                      placeholder="tag1, tag2"
                      value={editor.tags}
                      onChange={(e) => setEditor({ ...editor, tags: e.target.value })}
                    />
                  </label>
                </div>

                <label className="block space-y-1 text-[calc(12rem/14)]">
                  <span className="text-muted-foreground">{t('Markdown content')}</span>
                  <Textarea
                    rows={10}
                    className="font-mono text-[calc(12rem/14)]"
                    value={editor.body}
                    onChange={(e) => setEditor({ ...editor, body: e.target.value })}
                  />
                </label>

                {(detail.links.length > 0 || detail.backlinks.length > 0) && (
                  <div className="space-y-1.5">
                    <p className="font-medium text-[calc(12rem/14)]">{t('Wikilinks')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.links.map((link) => (
                        <button
                          key={`out:${link.target}`}
                          type="button"
                          disabled={!link.resolvedNoteId}
                          onClick={() => link.resolvedNoteId && openDetail(link.resolvedNoteId)}
                          className={cn(
                            'rounded border px-1.5 py-0.5 font-mono text-[calc(11rem/14)]',
                            link.isBroken
                              ? 'border-destructive/50 text-destructive'
                              : 'hover:bg-accent/60'
                          )}
                        >
                          → [[{link.target}]]
                        </button>
                      ))}
                      {detail.backlinks.map((bl) => (
                        <button
                          key={`in:${bl.noteId}`}
                          type="button"
                          onClick={() => openDetail(bl.noteId)}
                          className="rounded border px-1.5 py-0.5 font-mono text-[calc(11rem/14)] hover:bg-accent/60"
                        >
                          ← [[{bl.slug}]]
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </DialogPanel>

              <DialogFooter className="flex-wrap">
                <Button
                  variant="ghost"
                  size="sm"
                  className="sm:me-auto"
                  onClick={() => setConfirmDeleteId(detail.id)}
                >
                  {t('Delete permanently')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void window.electronAPI.memory.openVault({
                      noteId: detail.id,
                      app: 'obsidian',
                    })
                  }
                >
                  {t('Open in Obsidian')}
                </Button>
                {detail.status === 'draft' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void verifyDetail()}
                  >
                    {t('Mark verified')}
                  </Button>
                )}
                {detail.isArchived ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runMutation(window.electronAPI.memory.restore(detail.id))}
                  >
                    {t('Restore')}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runMutation(window.electronAPI.memory.archive(detail.id))}
                  >
                    {t('Archive')}
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={busy || !editor.title.trim()}
                  onClick={() => void saveEdit()}
                >
                  {t('Save')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={creating !== null} onOpenChange={(open) => !open && setCreating(null)}>
        <DialogContent className="sm:max-w-xl">
          {creating && (
            <>
              <DialogHeader>
                <DialogTitle>{t('New note')}</DialogTitle>
                <DialogDescription>
                  {t('Saved as an OKF v0.2 Markdown file in the selected vault.')}
                </DialogDescription>
              </DialogHeader>
              <DialogPanel className="space-y-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="space-y-1 text-[calc(12rem/14)]">
                    <span className="text-muted-foreground">{t('Title')}</span>
                    <Input
                      size="sm"
                      value={creating.title}
                      onChange={(e) => setCreating({ ...creating, title: e.target.value })}
                    />
                  </label>
                  <label className="space-y-1 text-[calc(12rem/14)]">
                    <span className="text-muted-foreground">{t('Category')}</span>
                    <Input
                      size="sm"
                      placeholder="systems / incidents / notes"
                      value={creating.type}
                      onChange={(e) => setCreating({ ...creating, type: e.target.value })}
                    />
                  </label>
                </div>
                <label className="block space-y-1 text-[calc(12rem/14)]">
                  <span className="text-muted-foreground">{t('Summary')}</span>
                  <Input
                    size="sm"
                    value={creating.description}
                    onChange={(e) => setCreating({ ...creating, description: e.target.value })}
                  />
                </label>
                <label className="block space-y-1 text-[calc(12rem/14)]">
                  <span className="text-muted-foreground">{t('Markdown content')}</span>
                  <Textarea
                    rows={8}
                    className="font-mono text-[calc(12rem/14)]"
                    value={creating.body}
                    onChange={(e) => setCreating({ ...creating, body: e.target.value })}
                  />
                </label>
              </DialogPanel>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" size="sm" />}>
                  {t('Cancel')}
                </DialogClose>
                <Button
                  size="sm"
                  disabled={busy || !creating.title.trim()}
                  onClick={() => void createNote()}
                >
                  {t('Create')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmBulkDelete}
        onOpenChange={(open) => !open && setConfirmBulkDelete(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('Delete {{count}} notes permanently?', { count: String(selected.size) })}
            </DialogTitle>
            <DialogDescription>
              {t(
                'This cannot be undone. Archiving keeps the note out of search while preserving it.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" />}>{t('Cancel')}</DialogClose>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => void bulkRun((id) => window.electronAPI.memory.delete(id))}
            >
              {t('Delete permanently')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Delete this note permanently?')}</DialogTitle>
            <DialogDescription>
              {t(
                'This cannot be undone. Archiving keeps the note out of search while preserving it.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" />}>{t('Cancel')}</DialogClose>
            <Button
              variant="destructive"
              size="sm"
              onClick={() =>
                confirmDeleteId && runMutation(window.electronAPI.memory.delete(confirmDeleteId))
              }
            >
              {t('Delete permanently')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default MemoryLibrary;
