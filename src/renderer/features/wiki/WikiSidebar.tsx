import type { MemoryNoteSummary, VaultDocKind, VaultSpaceDto } from '@shared/memory/dto';
import { motion } from 'framer-motion';
import {
  Archive,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  FolderTree,
  Plus,
  Search,
  Tags,
} from 'lucide-react';
import * as React from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { imageStudioPanelTransition, prefersReducedMotion } from '../imageStudio/panelMotion';
import type { WikiTreeGroupMode, WikiTreeNode } from './wikiTree';

export type WikiSelection =
  | { kind: 'note'; id: string }
  | { kind: 'doc'; spaceId: string; docKind: VaultDocKind };

const ICON_BTN =
  'flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';

export function WikiSidebar({
  collapsed,
  sidebarWidth,
  resizing,
  spaces,
  spaceId,
  onSelectSpace,
  tree,
  groupMode,
  onGroupModeChange,
  query,
  onQueryChange,
  selection,
  onSelectNote,
  onSelectDoc,
  onCreateNote,
  onOpenObsidian,
  onOpenFolder,
  activeSpaceIndexFilename,
}: {
  collapsed: boolean;
  sidebarWidth: number;
  resizing: boolean;
  spaces: VaultSpaceDto[];
  spaceId: string;
  onSelectSpace: (spaceId: string) => void;
  tree: WikiTreeNode[];
  groupMode: WikiTreeGroupMode;
  onGroupModeChange: (mode: WikiTreeGroupMode) => void;
  query: string;
  onQueryChange: (q: string) => void;
  selection: WikiSelection | null;
  onSelectNote: (note: MemoryNoteSummary) => void;
  onSelectDoc: (kind: VaultDocKind) => void;
  onCreateNote: () => void;
  onOpenObsidian: () => void;
  onOpenFolder: () => void;
  activeSpaceIndexFilename: string;
}) {
  const { t } = useI18n();
  const reducedMotion = prefersReducedMotion();
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(
    () => new Set(['dir:wiki', 'type:systems', 'type:incidents', 'type:domains', 'type:practices'])
  );

  // Auto-expand newly populated top-level folders
  React.useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const node of tree) {
        if (node.kind === 'folder' && node.label !== 'archive') {
          next.add(node.id);
          for (const child of node.children) {
            if (child.kind === 'folder') next.add(child.id);
          }
        }
      }
      return next.size === prev.size ? prev : next;
    });
  }, [tree]);

  const toggleFolder = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const spaceItems = spaces.map((s) => ({
    value: s.spaceId,
    label: `${s.label} (${s.noteCount})`,
  }));
  const activeSpace = spaces.find((s) => s.spaceId === spaceId);

  const docs: { kind: VaultDocKind; label: string }[] = [
    { kind: 'index', label: activeSpaceIndexFilename },
    { kind: 'schema', label: 'schema.md' },
    { kind: 'log', label: 'log.md' },
  ];

  const renderNode = (node: WikiTreeNode, depth: number): React.ReactNode => {
    if (node.kind === 'folder') {
      const isOpen = query.trim().length > 0 || expanded.has(node.id);
      const isArchive = node.label === 'archive';
      return (
        <div key={node.id}>
          <button
            type="button"
            onClick={() => toggleFolder(node.id)}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[calc(12.5rem/14)] font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          >
            {isOpen ? (
              <ChevronDown className="size-3.5 shrink-0" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0" />
            )}
            {isArchive ? (
              <Archive className="size-3.5 shrink-0" />
            ) : (
              <Folder className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{node.label}</span>
            <span className="shrink-0 text-[calc(11rem/14)] tabular-nums opacity-70">
              {countNotes(node)}
            </span>
          </button>
          {isOpen && (
            <div className="space-y-0.5">
              {node.children.map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const note = node.note!;
    const selected = selection?.kind === 'note' && selection.id === note.id;
    return (
      <button
        key={node.id}
        type="button"
        onClick={() => onSelectNote(note)}
        style={{ paddingLeft: `${22 + depth * 12}px` }}
        title={note.relPath}
        aria-current={selected ? 'page' : undefined}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-[calc(12.5rem/14)] transition-colors',
          selected
            ? 'bg-selection font-medium text-selection-foreground'
            : 'text-foreground/85 hover:bg-accent/60'
        )}
      >
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{note.title || node.label}</span>
        {note.status === 'draft' && !note.isArchived && (
          <span
            title={t('Draft')}
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-amber-500/80"
          />
        )}
        {note.isRaw && (
          <span className="shrink-0 rounded bg-muted px-1 font-mono text-[calc(10rem/14)] text-muted-foreground">
            raw
          </span>
        )}
      </button>
    );
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 0 : sidebarWidth }}
      transition={imageStudioPanelTransition({
        resizing,
        reducedMotion,
        targetW: collapsed ? 0 : sidebarWidth,
      })}
      aria-hidden={collapsed || undefined}
      className="flex min-h-0 shrink-0 flex-col overflow-hidden bg-nav"
      data-slot="wiki-sidebar"
      data-workbench-sidebar=""
    >
      <div
        className={cn('flex h-full min-h-0 flex-col', collapsed && 'hidden')}
        style={{ width: Math.max(0, sidebarWidth - 2) }}
      >
        <div className="flex h-[44px] shrink-0 items-center gap-1 px-3">
          <BookOpen className="size-4 shrink-0 text-brand" />
          <span className="truncate font-medium text-[calc(13rem/14)]">{t('Wiki')}</span>
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              className={cn(ICON_BTN, groupMode === 'folder' && 'bg-muted text-foreground')}
              aria-label={t('Folder tree')}
              title={t('Folder tree')}
              onClick={() => onGroupModeChange(groupMode === 'folder' ? 'type' : 'folder')}
            >
              {groupMode === 'folder' ? (
                <FolderTree className="size-3.5" />
              ) : (
                <Tags className="size-3.5" />
              )}
            </button>
            <button
              type="button"
              className={cn(ICON_BTN, searchOpen && 'bg-muted text-foreground')}
              aria-label={t('Search wiki notes')}
              title={t('Search wiki notes')}
              onClick={() => setSearchOpen((v) => !v)}
            >
              <Search className="size-3.5" />
            </button>
            <button
              type="button"
              className={ICON_BTN}
              aria-label={t('New note')}
              title={t('New note')}
              onClick={onCreateNote}
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>

        <div className="space-y-2 px-3 pb-2">
          {spaces.length > 0 && (
            <Select
              value={spaceId}
              items={spaceItems}
              onValueChange={(value) => value && onSelectSpace(String(value))}
            >
              <SelectTrigger size="sm" className="w-full text-[calc(12rem/14)]">
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
          )}
          {searchOpen && (
            <Input
              autoFocus
              size="sm"
              aria-label={t('Search wiki notes')}
              placeholder={t('Search wiki notes')}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
            />
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <div className="mb-2 space-y-0.5">
            {docs.map((doc) => {
              const selected =
                selection?.kind === 'doc' &&
                selection.spaceId === spaceId &&
                selection.docKind === doc.kind;
              return (
                <button
                  key={doc.kind}
                  type="button"
                  onClick={() => onSelectDoc(doc.kind)}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left font-mono text-[calc(11.5rem/14)] transition-colors',
                    selected
                      ? 'bg-selection font-medium text-selection-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                  )}
                >
                  <FileText className="size-3 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{doc.label}</span>
                </button>
              );
            })}
          </div>

          <div className="my-2 border-border/60 border-t" />

          {tree.length === 0 ? (
            <p className="mx-1 rounded-md border border-dashed border-border px-3 py-5 text-center text-muted-foreground text-[calc(12rem/14)]">
              {query.trim() ? t('No notes match these filters.') : t('No wiki notes yet.')}
            </p>
          ) : (
            <div className="space-y-0.5">{tree.map((node) => renderNode(node, 0))}</div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-1 border-border/60 border-t px-2.5 py-2 text-[calc(11.5rem/14)] text-muted-foreground">
          <span className="truncate font-mono" title={activeSpace?.rootPath}>
            {activeSpace?.isExternal ? t('Obsidian Vault') : t('Managed')}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              className={ICON_BTN}
              title={t('Open in Obsidian')}
              aria-label={t('Open in Obsidian')}
              onClick={onOpenObsidian}
            >
              <ExternalLink className="size-3.5" />
            </button>
            <button
              type="button"
              className={ICON_BTN}
              title={t('Open folder')}
              aria-label={t('Open folder')}
              onClick={onOpenFolder}
            >
              <FolderOpen className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </motion.aside>
  );
}

function countNotes(node: WikiTreeNode): number {
  if (node.kind === 'note') return 1;
  return node.children.reduce((acc, child) => acc + countNotes(child), 0);
}
