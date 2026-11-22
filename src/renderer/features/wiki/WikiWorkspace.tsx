import type { NoteStatus } from '@shared/memory/constants';
import type {
  MemoryNoteDetail,
  MemoryNoteSummary,
  VaultDocDto,
  VaultSpaceDto,
} from '@shared/memory/dto';
import { resolveWikiLinkTarget } from '@shared/memory/markdown';
import { Archive, Code2, Columns2, ExternalLink, Eye, RotateCcw, Save, Trash2 } from 'lucide-react';
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResizeHandle } from '@/components/chat/ResizeHandle';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useSessionsStore } from '@/stores/sessions';
import { resolveSidePanelWidth } from '@/stores/sidePanel/width';
import { useWikiWorkspaceStore } from './store';
import { WikiInspector } from './WikiInspector';
import { WikiMarkdownPreview } from './WikiMarkdownPreview';
import { type WikiSelection, WikiSidebar } from './WikiSidebar';
import { buildWikiFileTree, type WikiTreeGroupMode } from './wikiTree';

type ViewMode = 'preview' | 'edit' | 'split';

interface NoteEditorState {
  title: string;
  type: string;
  description: string;
  status: NoteStatus;
  tags: string;
  staleAfter: string;
  body: string;
}

interface PendingNavigation {
  selection: WikiSelection | null;
  spaceId?: string;
}

interface CreateNoteDraft {
  spaceId: string;
  slug: string;
  title: string;
  type: string;
  description: string;
  tags: string;
  body: string;
}

function toEditorState(detail: MemoryNoteDetail): NoteEditorState {
  return {
    title: detail.title,
    type: detail.type,
    description: detail.description,
    status: detail.status,
    tags: detail.tags.join(', '),
    staleAfter: detail.staleAfter ?? '',
    body: detail.body,
  };
}

function isNoteEditorDirty(
  detail: MemoryNoteDetail | null,
  editor: NoteEditorState | null
): boolean {
  if (!detail || !editor) return false;
  return (
    editor.title !== detail.title ||
    editor.type !== detail.type ||
    editor.description !== detail.description ||
    editor.status !== detail.status ||
    editor.tags !== detail.tags.join(', ') ||
    editor.staleAfter !== (detail.staleAfter ?? '') ||
    editor.body !== detail.body
  );
}

function parseCreatePrefill(target: string, spaceId: string): CreateNoteDraft {
  const cleaned = target.replace(/^\/+|\/+$/g, '').replace(/\.md$/i, '');
  const parts = cleaned.split('/').filter(Boolean);
  const type = parts.length > 1 ? parts[0] : 'notes';
  const leaf = parts.at(-1) ?? cleaned;
  const title = leaf
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  return {
    spaceId,
    slug: cleaned || undefined,
    title: title || 'New Note',
    type,
    description: '',
    tags: '',
    body: '',
  } as CreateNoteDraft;
}

export function WikiWorkspace({
  collapsed,
  sidebarWidth,
  onResize,
  onInspectorResizingChange,
  workspaceRef,
}: {
  collapsed: boolean;
  sidebarWidth: number;
  onResize(deltaX: number): void;
  onInspectorResizingChange(resizing: boolean): void;
  workspaceRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useI18n();
  const inspectorOpen = useWikiWorkspaceStore((s) => s.inspectorOpen);
  const preferredInspectorWidth = useWikiWorkspaceStore((s) => s.inspectorWidth);
  const storedSpaceId = useWikiWorkspaceStore((s) => s.selectedSpaceId);
  const requestedNoteId = useWikiWorkspaceStore((s) => s.requestedNoteId);
  const actions = useWikiWorkspaceStore.getState();

  const activeProjectId = useSessionsStore((s) => {
    const conv = s.activeId ? s.conversations[s.activeId] : undefined;
    return conv?.projectId ?? null;
  });

  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [inspectorResizing, setInspectorResizing] = useState(false);
  const inspectorWidth = resolveSidePanelWidth(preferredInspectorWidth, workspaceWidth);

  useEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const measure = () => setWorkspaceWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [workspaceRef]);

  const [spaces, setSpaces] = useState<VaultSpaceDto[]>([]);
  const [notes, setNotes] = useState<MemoryNoteSummary[]>([]);
  const [groupMode, setGroupMode] = useState<WikiTreeGroupMode>('folder');
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<WikiSelection | null>(null);
  const [detail, setDetail] = useState<MemoryNoteDetail | null>(null);
  const [editor, setEditor] = useState<NoteEditorState | null>(null);
  const [vaultDoc, setVaultDoc] = useState<VaultDocDto | null>(null);
  const [schemaDraft, setSchemaDraft] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [metaExpanded, setMetaExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [externalConflict, setExternalConflict] = useState(false);
  const [pendingNav, setPendingNav] = useState<PendingNavigation | null>(null);
  const [creating, setCreating] = useState<CreateNoteDraft | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const activeSpaceId = useMemo(() => {
    if (spaces.length === 0) {
      return storedSpaceId ?? (activeProjectId ? `proj:${activeProjectId}` : 'global');
    }
    if (storedSpaceId && spaces.some((s) => s.spaceId === storedSpaceId)) return storedSpaceId;
    if (activeProjectId) {
      const projSpace = `proj:${activeProjectId}`;
      if (spaces.some((s) => s.spaceId === projSpace)) return projSpace;
    }
    return (
      spaces.find((s) => s.kind === 'project')?.spaceId ??
      spaces.find((s) => s.spaceId === 'global')?.spaceId ??
      spaces[0]?.spaceId ??
      'global'
    );
  }, [storedSpaceId, spaces, activeProjectId]);

  const activeSpace = useMemo(
    () => spaces.find((s) => s.spaceId === activeSpaceId),
    [spaces, activeSpaceId]
  );

  const dirtyNote = isNoteEditorDirty(detail, editor);
  const dirtySchema =
    selection?.kind === 'doc' &&
    selection.docKind === 'schema' &&
    vaultDoc !== null &&
    schemaDraft !== vaultDoc.content;
  const hasUnsavedChanges = dirtyNote || dirtySchema;

  const dirtyRef = useRef(hasUnsavedChanges);
  dirtyRef.current = hasUnsavedChanges;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const detailRef = useRef(detail);
  detailRef.current = detail;

  const loadSpacesAndNotes = useCallback(async (targetSpaceId: string, q: string) => {
    const [spaceList, noteList] = await Promise.all([
      window.electronAPI.memory.spaces(),
      window.electronAPI.memory.list({
        spaceId: targetSpaceId,
        query: q.trim() || undefined,
        includeArchived: true,
        includeRaw: true,
        limit: 500,
        offset: 0,
      }),
    ]);
    setSpaces(spaceList);
    setNotes(noteList.items);
    return { spaceList, items: noteList.items };
  }, []);

  const loadSelectionContent = useCallback(async (sel: WikiSelection | null) => {
    setExternalConflict(false);
    if (!sel) {
      setDetail(null);
      setEditor(null);
      setVaultDoc(null);
      return;
    }
    if (sel.kind === 'note') {
      setVaultDoc(null);
      const next = await window.electronAPI.memory.detail(sel.id);
      setDetail(next);
      setEditor(next ? toEditorState(next) : null);
      return;
    }
    setDetail(null);
    setEditor(null);
    const doc = await window.electronAPI.memory.readVaultDoc(sel.spaceId, sel.docKind);
    setVaultDoc(doc);
    if (doc?.kind === 'schema') setSchemaDraft(doc.content);
  }, []);

  // Reload spaces & notes whenever activeSpaceId or search query changes
  useEffect(() => {
    let cancelled = false;
    void loadSpacesAndNotes(activeSpaceId, query).then(({ items }) => {
      if (cancelled || useWikiWorkspaceStore.getState().requestedNoteId) return;
      const cur = selectionRef.current;
      const belongsToSpace =
        (cur?.kind === 'note' && items.some((n) => n.id === cur.id)) ||
        (cur?.kind === 'doc' && cur.spaceId === activeSpaceId);
      if (!belongsToSpace) {
        const firstActive = items.find((n) => !n.isArchived && !n.isRaw) ?? items[0];
        const nextSel: WikiSelection = firstActive
          ? { kind: 'note', id: firstActive.id }
          : { kind: 'doc', spaceId: activeSpaceId, docKind: 'index' };
        setSelection(nextSel);
        void loadSelectionContent(nextSel);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeSpaceId, query, loadSpacesAndNotes, loadSelectionContent]);

  // Honor external jump requests (openNote)
  useEffect(() => {
    if (!requestedNoteId) return;
    const sep = requestedNoteId.indexOf('::');
    if (sep > 0) {
      actions.setSelectedSpaceId(requestedNoteId.slice(0, sep));
    }
    const sel: WikiSelection = { kind: 'note', id: requestedNoteId };
    setSelection(sel);
    void loadSelectionContent(sel);
    actions.consumeRequestedNote();
  }, [requestedNoteId, actions, loadSelectionContent]);

  // Live refresh on external Obsidian / agent writes
  useEffect(() => {
    return window.electronAPI.memory.onChanged(() => {
      void loadSpacesAndNotes(activeSpaceId, query);
      const cur = selectionRef.current;
      if (!cur) return;
      if (cur.kind === 'note') {
        void window.electronAPI.memory.detail(cur.id).then((latest) => {
          if (!latest) return;
          const loaded = detailRef.current;
          if (!dirtyRef.current) {
            setDetail(latest);
            setEditor(toEditorState(latest));
            setExternalConflict(false);
          } else if (loaded && latest.updatedAt !== loaded.updatedAt) {
            setExternalConflict(true);
          }
        });
      } else {
        void window.electronAPI.memory.readVaultDoc(cur.spaceId, cur.docKind).then((doc) => {
          if (!doc) return;
          if (!dirtyRef.current) {
            setVaultDoc(doc);
            if (doc.kind === 'schema') setSchemaDraft(doc.content);
          } else if (cur.docKind === 'schema') {
            setExternalConflict(true);
          }
        });
      }
    });
  }, [activeSpaceId, query, loadSpacesAndNotes]);

  const applyPendingNavigation = useCallback(
    (nav: PendingNavigation) => {
      if (nav.spaceId && nav.spaceId !== activeSpaceId) {
        actions.setSelectedSpaceId(nav.spaceId);
      }
      setSelection(nav.selection);
      void loadSelectionContent(nav.selection);
      setPendingNav(null);
    },
    [activeSpaceId, actions, loadSelectionContent]
  );

  const navigateWithGuard = useCallback(
    (nextSelection: WikiSelection | null, targetSpaceId?: string) => {
      if (hasUnsavedChanges) {
        setPendingNav({ selection: nextSelection, spaceId: targetSpaceId });
        return;
      }
      applyPendingNavigation({ selection: nextSelection, spaceId: targetSpaceId });
    },
    [hasUnsavedChanges, applyPendingNavigation]
  );

  const saveCurrent = useCallback(
    async (opts: { force?: boolean } = {}): Promise<boolean> => {
      if (selection?.kind === 'doc' && selection.docKind === 'schema') {
        setBusy(true);
        try {
          const res = await window.electronAPI.memory.saveSchema(selection.spaceId, schemaDraft);
          if (res.ok) {
            setExternalConflict(false);
            await loadSelectionContent(selection);
            addToast({ type: 'success', title: t('Schema saved') });
            return true;
          }
          addToast({ type: 'error', title: t('Save failed'), description: res.error });
          return false;
        } finally {
          setBusy(false);
        }
      }

      if (!detail || !editor) return false;
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
          expectedUpdatedAt: opts.force ? null : detail.updatedAt,
        });
        if (res.ok && res.note) {
          setDetail(res.note);
          setEditor(toEditorState(res.note));
          setExternalConflict(false);
          await loadSpacesAndNotes(activeSpaceId, query);
          addToast({ type: 'success', title: t('Saved') });
          return true;
        }
        if (res.conflict) {
          setExternalConflict(true);
          addToast({
            type: 'warning',
            title: t('External modification detected'),
            description: t('Reload from disk or force overwrite.'),
          });
          return false;
        }
        addToast({ type: 'error', title: t('Save failed'), description: res.error });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [
      selection,
      schemaDraft,
      detail,
      editor,
      loadSelectionContent,
      loadSpacesAndNotes,
      activeSpaceId,
      query,
      t,
    ]
  );

  // Cmd/Ctrl + S shortcut inside Wiki workspace
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        if (!hasUnsavedChanges) return;
        e.preventDefault();
        void saveCurrent();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasUnsavedChanges, saveCurrent]);

  const handleArchiveToggle = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const res = detail.isArchived
        ? await window.electronAPI.memory.restore(detail.id)
        : await window.electronAPI.memory.archive(detail.id);
      if (res.ok && res.note) {
        const nextSel: WikiSelection = { kind: 'note', id: res.note.id };
        setSelection(nextSel);
        setDetail(res.note);
        setEditor(toEditorState(res.note));
        await loadSpacesAndNotes(activeSpaceId, query);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteNote = async () => {
    if (!confirmDeleteId) return;
    setBusy(true);
    try {
      const res = await window.electronAPI.memory.delete(confirmDeleteId);
      setConfirmDeleteId(null);
      if (res.ok) {
        const { items } = await loadSpacesAndNotes(activeSpaceId, query);
        const fallback = items[0]
          ? ({ kind: 'note', id: items[0].id } as const)
          : ({ kind: 'doc', spaceId: activeSpaceId, docKind: 'index' } as const);
        setSelection(fallback);
        await loadSelectionContent(fallback);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCreateNote = async () => {
    if (!creating?.title.trim()) return;
    setBusy(true);
    try {
      const res = await window.electronAPI.memory.create({
        spaceId: creating.spaceId,
        slug: creating.slug.trim() || undefined,
        title: creating.title.trim(),
        type: creating.type.trim() || 'notes',
        description: creating.description.trim() || undefined,
        tags: creating.tags
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        body: creating.body,
      });
      if (res.ok && res.note) {
        setCreating(null);
        await loadSpacesAndNotes(activeSpaceId, query);
        const sel: WikiSelection = { kind: 'note', id: res.note.id };
        setSelection(sel);
        setDetail(res.note);
        setEditor(toEditorState(res.note));
        setViewMode('edit');
      } else {
        addToast({ type: 'error', title: t('Create failed'), description: res.error });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleOpenWikiLink = useCallback(
    (target: string) => {
      const matchedRel = resolveWikiLinkTarget(
        target,
        notes.map((n) => ({ relPath: n.relPath, slug: n.slug, title: n.title }))
      );
      if (matchedRel) {
        const note = notes.find((n) => n.relPath === matchedRel);
        if (note) {
          navigateWithGuard({ kind: 'note', id: note.id });
          return;
        }
      }
      setCreating(parseCreatePrefill(target, activeSpaceId));
    },
    [notes, activeSpaceId, navigateWithGuard]
  );

  const tree = useMemo(() => buildWikiFileTree(notes, { groupMode }), [notes, groupMode]);

  const brokenTargets = useMemo(() => {
    const out = new Set<string>();
    for (const link of detail?.links ?? []) {
      if (link.isBroken) out.add(link.target);
    }
    return out;
  }, [detail]);

  const isSchemaDoc = selection?.kind === 'doc' && selection.docKind === 'schema';
  const canEdit =
    (selection?.kind === 'note' && detail && !detail.isRaw && editor !== null) || isSchemaDoc;

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1"
      data-slot="wiki-workspace"
      aria-label={t('Wiki')}
    >
      <WikiSidebar
        collapsed={collapsed}
        sidebarWidth={sidebarWidth}
        resizing={sidebarResizing}
        spaces={spaces}
        spaceId={activeSpaceId}
        onSelectSpace={(nextSpaceId) => navigateWithGuard(null, nextSpaceId)}
        tree={tree}
        groupMode={groupMode}
        onGroupModeChange={setGroupMode}
        query={query}
        onQueryChange={setQuery}
        selection={selection}
        onSelectNote={(note) => navigateWithGuard({ kind: 'note', id: note.id })}
        onSelectDoc={(docKind) =>
          navigateWithGuard({ kind: 'doc', spaceId: activeSpaceId, docKind })
        }
        onCreateNote={() =>
          setCreating({
            spaceId: activeSpaceId,
            slug: '',
            title: '',
            type: 'notes',
            description: '',
            tags: '',
            body: '',
          })
        }
        onOpenObsidian={() =>
          void window.electronAPI.memory.openVault(
            selection?.kind === 'note'
              ? { noteId: selection.id, app: 'obsidian' }
              : { spaceId: activeSpaceId, app: 'obsidian' }
          )
        }
        onOpenFolder={() =>
          void window.electronAPI.memory.openVault({ spaceId: activeSpaceId, app: 'folder' })
        }
        activeSpaceIndexFilename={activeSpace?.indexFilename ?? 'index.md'}
      />

      {!collapsed && (
        <ResizeHandle
          onResize={onResize}
          onResizingChange={setSidebarResizing}
          className="ml-[3px] -mr-[3px]"
        />
      )}

      <div
        ref={workspaceRef}
        data-slot="workbench-main"
        data-workbench-card=""
        data-workbench-split=""
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        <div
          data-workbench-pane=""
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
        >
          {/* Top toolbar */}
          <div className="flex h-[44px] shrink-0 items-center justify-between gap-2 border-border/60 border-b px-4">
            <div className="flex min-w-0 items-center gap-2">
              {selection?.kind === 'note' && detail ? (
                <>
                  <span className="truncate font-mono text-[calc(12rem/14)] text-muted-foreground">
                    [[{detail.slug}]]
                  </span>
                  <Badge variant={detail.status === 'verified' ? 'default' : 'outline'}>
                    {t(
                      detail.status === 'verified'
                        ? 'Verified'
                        : detail.status === 'draft'
                          ? 'Draft'
                          : 'Deprecated'
                    )}
                  </Badge>
                  {hasUnsavedChanges && (
                    <Badge variant="secondary" className="text-[calc(11rem/14)]">
                      {t('Unsaved')}
                    </Badge>
                  )}
                </>
              ) : vaultDoc ? (
                <span className="truncate font-mono text-[calc(12.5rem/14)] font-medium">
                  {vaultDoc.filename}
                </span>
              ) : (
                <span className="text-muted-foreground text-[calc(13rem/14)]">{t('Wiki')}</span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {canEdit && (
                <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
                  {(
                    [
                      { id: 'preview', icon: Eye, label: t('Preview') },
                      { id: 'edit', icon: Code2, label: t('Edit') },
                      { id: 'split', icon: Columns2, label: t('Split') },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setViewMode(m.id)}
                      className={cn(
                        'flex h-6 items-center gap-1 rounded px-2 text-[calc(11.5rem/14)] font-medium transition-colors',
                        viewMode === m.id
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <m.icon className="size-3" />
                      {m.label}
                    </button>
                  ))}
                </div>
              )}

              {selection?.kind === 'note' && detail && !detail.isRaw && (
                <>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    title={detail.isArchived ? t('Restore') : t('Archive')}
                    onClick={() => void handleArchiveToggle()}
                  >
                    {detail.isArchived ? (
                      <RotateCcw className="size-3.5" />
                    ) : (
                      <Archive className="size-3.5" />
                    )}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    title={t('Delete permanently')}
                    onClick={() => setConfirmDeleteId(detail.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </>
              )}

              <Button
                size="xs"
                variant="ghost"
                title={t('Open in Obsidian')}
                onClick={() =>
                  void window.electronAPI.memory.openVault(
                    selection?.kind === 'note'
                      ? { noteId: selection.id, app: 'obsidian' }
                      : { spaceId: activeSpaceId, app: 'obsidian' }
                  )
                }
              >
                <ExternalLink className="size-3.5" />
              </Button>

              {canEdit && (
                <Button
                  size="xs"
                  disabled={busy || !hasUnsavedChanges}
                  onClick={() => void saveCurrent()}
                >
                  <Save className="mr-1 size-3" />
                  {t('Save')}
                </Button>
              )}
            </div>
          </div>

          {/* External conflict banner */}
          {externalConflict && (
            <div className="flex shrink-0 items-center justify-between gap-3 border-amber-500/30 border-b bg-amber-500/10 px-4 py-2 text-[calc(12rem/14)] text-amber-800 dark:text-amber-200">
              <span>
                {t(
                  'This file changed on disk (e.g. in Obsidian). Reload to avoid losing external edits.'
                )}
              </span>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => selection && void loadSelectionContent(selection)}
                >
                  {t('Reload')}
                </Button>
                <Button size="xs" onClick={() => void saveCurrent({ force: true })}>
                  {t('Overwrite')}
                </Button>
              </div>
            </div>
          )}

          {/* Note OKF v0.2 metadata header */}
          {selection?.kind === 'note' && detail && editor && !detail.isRaw && (
            <div className="shrink-0 border-border/50 border-b px-5 py-2.5">
              <div className="flex items-center gap-2">
                <Input
                  value={editor.title}
                  onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                  className="h-8 border-transparent bg-transparent px-1 font-semibold text-base shadow-none focus-visible:border-border focus-visible:bg-background"
                  placeholder={t('Title')}
                />
                <button
                  type="button"
                  onClick={() => setMetaExpanded((v) => !v)}
                  className="shrink-0 rounded px-2 py-1 text-[calc(11.5rem/14)] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {metaExpanded ? t('Hide properties') : t('Properties')}
                </button>
              </div>
              {editor.description && !metaExpanded && (
                <p className="px-1 text-[calc(12.5rem/14)] text-muted-foreground">
                  {editor.description}
                </p>
              )}
              {metaExpanded && (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label className="space-y-0.5 text-[calc(11.5rem/14)]">
                    <span className="text-muted-foreground">{t('Category')}</span>
                    <Input
                      size="sm"
                      value={editor.type}
                      onChange={(e) => setEditor({ ...editor, type: e.target.value })}
                    />
                  </label>
                  <label className="space-y-0.5 text-[calc(11.5rem/14)] sm:col-span-2">
                    <span className="text-muted-foreground">{t('Summary')}</span>
                    <Input
                      size="sm"
                      value={editor.description}
                      onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                    />
                  </label>
                  <label className="space-y-0.5 text-[calc(11.5rem/14)] sm:col-span-2">
                    <span className="text-muted-foreground">{t('Tags')}</span>
                    <Input
                      size="sm"
                      placeholder="tag1, tag2"
                      value={editor.tags}
                      onChange={(e) => setEditor({ ...editor, tags: e.target.value })}
                    />
                  </label>
                  <label className="space-y-0.5 text-[calc(11.5rem/14)]">
                    <span className="text-muted-foreground">{t('Stale after')}</span>
                    <Input
                      size="sm"
                      placeholder="YYYY-MM-DD"
                      value={editor.staleAfter}
                      onChange={(e) => setEditor({ ...editor, staleAfter: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Body / Preview / Split */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {selection?.kind === 'note' && detail ? (
              detail.isRaw ? (
                <div className="h-full overflow-y-auto px-6 py-5">
                  <div className="mb-3 rounded border border-border/60 bg-muted/40 px-3 py-1.5 text-[calc(12rem/14)] text-muted-foreground">
                    {t('raw/ reference notes are read-only.')}
                  </div>
                  <WikiMarkdownPreview
                    markdown={detail.body || detail.rawMarkdown}
                    onOpenWikiLink={handleOpenWikiLink}
                  />
                </div>
              ) : editor ? (
                <div
                  className={cn(
                    'h-full',
                    viewMode === 'split' && 'grid grid-cols-2 divide-x divide-border/60'
                  )}
                >
                  {(viewMode === 'edit' || viewMode === 'split') && (
                    <textarea
                      aria-label={t('Markdown content')}
                      value={editor.body}
                      onChange={(e) => setEditor({ ...editor, body: e.target.value })}
                      spellCheck={false}
                      placeholder={t('Write Markdown with [[wikilink]] references…')}
                      className="h-full w-full resize-none bg-transparent px-6 py-5 font-mono text-[calc(13rem/14)] leading-6 outline-none"
                    />
                  )}
                  {(viewMode === 'preview' || viewMode === 'split') && (
                    <div className="h-full overflow-y-auto px-6 py-5">
                      {editor.body.trim() ? (
                        <WikiMarkdownPreview
                          markdown={editor.body}
                          brokenTargets={brokenTargets}
                          onOpenWikiLink={handleOpenWikiLink}
                        />
                      ) : (
                        <p className="py-10 text-center text-muted-foreground text-[calc(13rem/14)]">
                          {t('Empty note. Switch to Edit to start writing.')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : null
            ) : selection?.kind === 'doc' && vaultDoc ? (
              isSchemaDoc ? (
                <div
                  className={cn(
                    'h-full',
                    viewMode === 'split' && 'grid grid-cols-2 divide-x divide-border/60'
                  )}
                >
                  {(viewMode === 'edit' || viewMode === 'split') && (
                    <textarea
                      aria-label="schema.md"
                      value={schemaDraft}
                      onChange={(e) => setSchemaDraft(e.target.value)}
                      spellCheck={false}
                      className="h-full w-full resize-none bg-transparent px-6 py-5 font-mono text-[calc(13rem/14)] leading-6 outline-none"
                    />
                  )}
                  {(viewMode === 'preview' || viewMode === 'split') && (
                    <div className="h-full overflow-y-auto px-6 py-5">
                      <WikiMarkdownPreview
                        markdown={schemaDraft}
                        onOpenWikiLink={handleOpenWikiLink}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-full overflow-y-auto px-6 py-5">
                  {vaultDoc.content.trim() ? (
                    <WikiMarkdownPreview
                      markdown={vaultDoc.content}
                      onOpenWikiLink={handleOpenWikiLink}
                    />
                  ) : (
                    <p className="py-10 text-center text-muted-foreground text-[calc(13rem/14)]">
                      {t('No entries yet.')}
                    </p>
                  )}
                </div>
              )
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground text-[calc(13rem/14)]">
                {t('No wiki notes yet.')}
              </div>
            )}
          </div>
        </div>

        {inspectorOpen && (
          <ResizeHandle
            onResize={(deltaX) => actions.resizeInspector(-deltaX, workspaceWidth)}
            onResizingChange={(r) => {
              setInspectorResizing(r);
              onInspectorResizingChange(r);
            }}
            className="w-[var(--workbench-card-gap)]"
          />
        )}

        <WikiInspector
          open={inspectorOpen}
          width={inspectorWidth}
          resizing={inspectorResizing}
          detail={selection?.kind === 'note' ? detail : null}
          onClose={() => actions.toggleInspector()}
          onNavigateNoteId={(id) => navigateWithGuard({ kind: 'note', id })}
          onCreateBrokenTarget={(target) => setCreating(parseCreatePrefill(target, activeSpaceId))}
        />
      </div>

      {/* Create Note Dialog */}
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
                      autoFocus
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
                  onClick={() => void handleCreateNote()}
                >
                  {t('Create')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Unsaved changes confirmation */}
      <AlertDialog open={pendingNav !== null} onOpenChange={(open) => !open && setPendingNav(null)}>
        <AlertDialogPopup className="sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Save changes?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('You have unsaved edits in this Markdown note.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter variant="bare">
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t('Cancel')}
            </AlertDialogClose>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => pendingNav && applyPendingNavigation(pendingNav)}
            >
              {t('Discard')}
            </Button>
            <Button
              size="sm"
              onClick={() =>
                pendingNav &&
                void saveCurrent().then((ok) => {
                  if (ok) applyPendingNavigation(pendingNav);
                })
              }
            >
              {t('Save')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
      >
        <AlertDialogPopup className="sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete this note permanently?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'This cannot be undone. Archiving keeps the note out of search while preserving it.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter variant="bare">
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t('Cancel')}
            </AlertDialogClose>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => void handleDeleteNote()}
            >
              {t('Delete permanently')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </section>
  );
}
