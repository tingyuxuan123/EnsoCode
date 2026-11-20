import type { MemoryNoteDetail } from '@shared/memory/dto';
import type { MemoryGraphDto, TreeGrouping, TreeNodeDto } from '@shared/memory/graphDto';
import * as React from 'react';
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
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/i18n';
import { MemoryTreeView } from './MemoryTreeView';

const MemoryGraphView = React.lazy(async () => ({
  default: (await import('./MemoryGraphView')).MemoryGraphView,
}));

const GRAPH_LIMIT = 150;
const TREE_LIMIT_PER_GROUP = 40;
const EMPTY_GRAPH: MemoryGraphDto = { nodes: [], edges: [], totalNotes: 0 };

type Mode = 'graph' | 'tree';

export function MemoryKnowledge({ revision = 0 }: { revision?: number } = {}) {
  const { t } = useI18n();
  const [mode, setMode] = React.useState<Mode>('graph');
  const [groupBy, setGroupBy] = React.useState<TreeGrouping>('type');
  const [graph, setGraph] = React.useState<MemoryGraphDto>(EMPTY_GRAPH);
  const [tree, setTree] = React.useState<TreeNodeDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<MemoryNoteDetail | null>(null);
  const [treeDialogDetail, setTreeDialogDetail] = React.useState<MemoryNoteDetail | null>(null);

  const reload = React.useCallback(() => {
    setLoading(true);
    const done = () => setLoading(false);
    if (mode === 'graph') {
      void window.electronAPI.memory
        .graph({ limit: GRAPH_LIMIT, includeOrphans: true })
        .then(setGraph)
        .finally(done);
    } else {
      void window.electronAPI.memory
        .tree({ groupBy, limitPerGroup: TREE_LIMIT_PER_GROUP })
        .then(setTree)
        .finally(done);
    }
  }, [mode, groupBy]);

  React.useEffect(reload, [reload]);
  const reloadRef = React.useRef(reload);
  reloadRef.current = reload;
  React.useEffect(() => window.electronAPI.memory.onChanged(() => reloadRef.current()), []);

  const seenRevision = React.useRef(revision);
  React.useEffect(() => {
    if (seenRevision.current === revision) return;
    seenRevision.current = revision;
    reload();
  }, [revision, reload]);

  React.useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void window.electronAPI.memory.detail(selectedId).then((next) => {
      if (!cancelled) setDetail(next);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const handleVerify = async (id: string) => {
    const res = await window.electronAPI.memory.update(id, { status: 'verified' });
    if (res.ok && res.note) {
      setDetail(res.note);
      if (treeDialogDetail?.id === id) setTreeDialogDetail(res.note);
      reload();
    }
  };

  const handleOpenObsidian = (id: string) => {
    void window.electronAPI.memory.openVault({ noteId: id, app: 'obsidian' });
  };

  const modeItems = [
    { value: 'graph', label: t('Graph') },
    { value: 'tree', label: t('Tree') },
  ];
  const groupItems = [
    { value: 'type', label: t('By type') },
    { value: 'status', label: t('By status') },
    { value: 'space', label: t('By space') },
  ];

  return (
    <div className="space-y-4" data-settings-row="memory.knowledge">
      <div>
        <h3 className="font-medium text-[calc(14rem/14)]">{t('Knowledge graph')}</h3>
        <p className="text-muted-foreground text-[calc(12rem/14)]">
          {t(
            'Browse [[wikilink]] connections as a graph or inspect notes grouped by category and trust status.'
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={mode}
          items={modeItems}
          onValueChange={(value) => setMode(value === 'tree' ? 'tree' : 'graph')}
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {modeItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {mode === 'tree' && (
          <Select
            value={groupBy}
            items={groupItems}
            onValueChange={(value) => setGroupBy((value as TreeGrouping) || 'type')}
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {groupItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        )}
      </div>

      {mode === 'graph' ? (
        <React.Suspense
          fallback={
            <p
              role="status"
              className="rounded-[6px] border px-3 py-6 text-muted-foreground text-[calc(13rem/14)]"
            >
              {t('Loading…')}
            </p>
          }
        >
          <MemoryGraphView
            graph={graph}
            loading={loading}
            selectedId={selectedId}
            onSelect={setSelectedId}
            detail={detail}
            onVerify={(id) => void handleVerify(id)}
            onOpenObsidian={handleOpenObsidian}
          />
        </React.Suspense>
      ) : (
        <MemoryTreeView
          tree={tree}
          loading={loading}
          onSelectNote={(id) => {
            void window.electronAPI.memory.detail(id).then((d) => {
              if (d) setTreeDialogDetail(d);
            });
          }}
        />
      )}

      <Dialog
        open={treeDialogDetail !== null}
        onOpenChange={(open) => !open && setTreeDialogDetail(null)}
      >
        <DialogContent className="sm:max-w-xl">
          {treeDialogDetail && (
            <>
              <DialogHeader>
                <DialogTitle>{treeDialogDetail.title}</DialogTitle>
                <DialogDescription>
                  [[{treeDialogDetail.slug}]] · {treeDialogDetail.type} ·{' '}
                  {treeDialogDetail.spaceLabel}
                </DialogDescription>
              </DialogHeader>
              <DialogPanel className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant={treeDialogDetail.status === 'verified' ? 'default' : 'outline'}>
                    {t(
                      treeDialogDetail.status === 'verified'
                        ? 'Verified'
                        : treeDialogDetail.status === 'draft'
                          ? 'Draft'
                          : 'Deprecated'
                    )}
                  </Badge>
                  {treeDialogDetail.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      #{tag}
                    </Badge>
                  ))}
                </div>
                {treeDialogDetail.description && (
                  <p className="text-muted-foreground text-[calc(12rem/14)]">
                    {treeDialogDetail.description}
                  </p>
                )}
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-[6px] bg-muted/40 p-3 font-sans text-[calc(13rem/14)] leading-relaxed">
                  {treeDialogDetail.body}
                </pre>
              </DialogPanel>
              <DialogFooter>
                {treeDialogDetail.status === 'draft' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleVerify(treeDialogDetail.id)}
                  >
                    {t('Mark verified')}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenObsidian(treeDialogDetail.id)}
                >
                  {t('Open in Obsidian')}
                </Button>
                <DialogClose render={<Button variant="outline" size="sm" />}>
                  {t('Close')}
                </DialogClose>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
