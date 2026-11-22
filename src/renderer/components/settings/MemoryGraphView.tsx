import type { MemoryNoteDetail } from '@shared/memory/dto';
import type { MemoryGraphDto } from '@shared/memory/graphDto';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { buildLegend, graphStylesheet, toElements } from './memoryGraphStyle';

let registered = false;
function ensureLayout(): void {
  if (registered) return;
  cytoscape.use(fcose);
  registered = true;
}

const LAYOUT = {
  name: 'fcose',
  animate: false,
  randomize: false,
  nodeRepulsion: 8000,
  idealEdgeLength: 90,
  nodeSeparation: 90,
  padding: 24,
  fit: true,
} as unknown as cytoscape.LayoutOptions;

export function MemoryGraphView({
  graph,
  selectedId,
  onSelect,
  detail,
  loading,
  onOpenObsidian,
}: {
  graph: MemoryGraphDto;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  detail: MemoryNoteDetail | null;
  loading: boolean;
  onOpenObsidian: (id: string) => void;
}) {
  const { t } = useI18n();
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const cyRef = React.useRef<cytoscape.Core | null>(null);
  const onSelectRef = React.useRef(onSelect);
  onSelectRef.current = onSelect;
  const [typeFilter, setTypeFilter] = React.useState<string | null>(null);

  const dark = React.useMemo(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
    []
  );

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host || graph.nodes.length === 0) return;
    ensureLayout();
    const cy = cytoscape({
      container: host,
      elements: toElements(graph.nodes, graph.edges, dark),
      style: graphStylesheet(dark),
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.2,
    });
    cy.layout(LAYOUT).run();
    cy.on('tap', 'node', (event) => onSelectRef.current(event.target.id() as string));
    cy.on('tap', (event) => {
      if (event.target === cy) onSelectRef.current(null);
    });
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [graph.nodes, graph.edges, dark]);

  React.useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass('dimmed').unselect();
      if (!selectedId) return;
      const node = cy.getElementById(selectedId);
      if (node.empty()) return;
      const keep = node.closedNeighborhood();
      cy.elements().difference(keep).addClass('dimmed');
      node.select();
    });
  }, [selectedId]);

  const legend = React.useMemo(() => buildLegend(graph.nodes, dark), [graph.nodes, dark]);
  const selected = graph.nodes.find((n) => n.id === selectedId) ?? null;

  React.useEffect(() => {
    const cy = cyRef.current;
    if (!cy || selectedId) return;
    cy.batch(() => {
      cy.elements().removeClass('dimmed');
      if (!typeFilter) return;
      cy.nodes()
        .filter((n) => n.data('noteType') !== typeFilter)
        .addClass('dimmed');
    });
  }, [typeFilter, selectedId]);

  if (graph.nodes.length === 0) {
    return (
      <p className="rounded-[6px] border px-3 py-6 text-muted-foreground text-[calc(13rem/14)]">
        {loading ? t('Loading…') : t('No wiki notes yet.')}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-[6px] border bg-muted/20">
        <div ref={hostRef} className="h-[calc(440rem/14)] w-full" />
        <div className="absolute right-2 bottom-2 flex gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => cyRef.current?.fit(undefined, 24)}
            title={t('Fit to view')}
          >
            {t('Fit')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => cyRef.current?.layout(LAYOUT).run()}
            title={t('Re-run layout')}
          >
            {t('Relayout')}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-muted-foreground text-[calc(12rem/14)]">
          {t('Color = category · size = wikilink connections')}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {legend.map((entry) => (
            <button
              key={entry.noteType}
              type="button"
              onClick={() => setTypeFilter(typeFilter === entry.noteType ? null : entry.noteType)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[calc(12rem/14)] transition-colors',
                typeFilter === entry.noteType
                  ? 'border-selection-border bg-selection text-selection-foreground'
                  : 'hover:bg-accent/50'
              )}
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground">{entry.noteType}</span>
              <span className="tabular-nums">{entry.count}</span>
            </button>
          ))}
        </div>
        <p className="text-muted-foreground text-[calc(12rem/14)]">
          {t('{{shown}} of {{total}} notes', {
            shown: String(graph.nodes.length),
            total: String(graph.totalNotes),
          })}
        </p>
      </div>

      {selected && (
        <section className="space-y-2.5 rounded-[6px] border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-[calc(13rem/14)]">
                <span className="truncate font-medium">{selected.title}</span>
                <Badge variant="secondary">{selected.noteType}</Badge>
                <Badge variant={selected.status === 'verified' ? 'default' : 'outline'}>
                  {t(
                    selected.status === 'verified'
                      ? 'Verified'
                      : selected.status === 'draft'
                        ? 'Draft'
                        : 'Deprecated'
                  )}
                </Badge>
              </p>
              <p className="font-mono text-muted-foreground text-[calc(11rem/14)]">
                [[{selected.slug}]] · {selected.spaceLabel}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" variant="outline" onClick={() => onOpenObsidian(selected.id)}>
                {t('Open in Obsidian')}
              </Button>
            </div>
          </div>

          {detail && detail.id === selected.id && (
            <div className="space-y-2 text-[calc(12rem/14)]">
              {detail.description && <p className="text-muted-foreground">{detail.description}</p>}
              {detail.body && (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-[6px] bg-muted/40 p-2.5 font-sans text-[calc(12rem/14)] leading-relaxed">
                  {detail.body}
                </pre>
              )}
              {(detail.links.length > 0 || detail.backlinks.length > 0) && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {detail.links.map((link) => (
                    <button
                      key={`out:${link.target}`}
                      type="button"
                      disabled={!link.resolvedNoteId}
                      onClick={() => link.resolvedNoteId && onSelect(link.resolvedNoteId)}
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
                      onClick={() => onSelect(bl.noteId)}
                      className="rounded border px-1.5 py-0.5 font-mono text-[calc(11rem/14)] hover:bg-accent/60"
                    >
                      ← [[{bl.slug}]]
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
