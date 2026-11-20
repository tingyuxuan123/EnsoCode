import type { MemoryNoteDetail } from '@shared/memory/dto';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { imageStudioPanelTransition, prefersReducedMotion } from '../imageStudio/panelMotion';

export function WikiInspector({
  open,
  width,
  resizing,
  detail,
  onClose,
  onNavigateNoteId,
  onCreateBrokenTarget,
}: {
  open: boolean;
  width: number;
  resizing: boolean;
  detail: MemoryNoteDetail | null;
  onClose: () => void;
  onNavigateNoteId: (id: string) => void;
  onCreateBrokenTarget: (target: string) => void;
}) {
  const { t } = useI18n();
  const reducedMotion = prefersReducedMotion();

  return (
    <motion.aside
      initial={false}
      animate={{ width: open ? width : 0 }}
      transition={imageStudioPanelTransition({
        resizing,
        reducedMotion,
        targetW: open ? width : 0,
      })}
      aria-hidden={!open || undefined}
      data-workbench-pane={open ? '' : undefined}
      className={cn(
        'flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden bg-background',
        !open && 'invisible'
      )}
      data-slot="wiki-inspector"
      aria-label={t('Wikilinks')}
    >
      <div
        className="flex h-full min-h-0 flex-col"
        style={{ width: Math.max(0, width - (open ? 2 : 0)) }}
      >
        <div className="flex h-[44px] shrink-0 items-center justify-between border-border/60 border-b px-3">
          <span className="font-medium text-[calc(13rem/14)]">{t('Wikilinks & Metadata')}</span>
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t('Close')}
            onClick={onClose}
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-[calc(12rem/14)]">
          {!detail ? (
            <p className="py-6 text-center text-muted-foreground">
              {t('Select a note to inspect its [[wikilink]] connections.')}
            </p>
          ) : (
            <>
              <section className="space-y-1.5">
                <div className="flex items-center justify-between font-medium text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <ArrowLeft className="size-3.5" />
                    {t('Backlinks')}
                  </span>
                  <span className="tabular-nums">{detail.backlinks.length}</span>
                </div>
                {detail.backlinks.length === 0 ? (
                  <p className="rounded border border-dashed border-border/70 px-2.5 py-2 text-muted-foreground">
                    {t('No notes link to this page yet.')}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {detail.backlinks.map((bl) => (
                      <li key={bl.noteId}>
                        <button
                          type="button"
                          onClick={() => onNavigateNoteId(bl.noteId)}
                          className="flex w-full items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-left transition-colors hover:bg-accent/60"
                        >
                          <span className="min-w-0 flex-1 truncate font-medium">{bl.title}</span>
                          <Badge variant="outline" className="shrink-0">
                            {bl.type}
                          </Badge>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-1.5">
                <div className="flex items-center justify-between font-medium text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <ArrowRight className="size-3.5" />
                    {t('Outbound links')}
                  </span>
                  <span className="tabular-nums">{detail.links.length}</span>
                </div>
                {detail.links.length === 0 ? (
                  <p className="rounded border border-dashed border-border/70 px-2.5 py-2 text-muted-foreground">
                    {t('No outbound [[wikilinks]].')}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {detail.links.map((link) => (
                      <li
                        key={link.target}
                        className="flex items-center justify-between gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            link.resolvedNoteId
                              ? onNavigateNoteId(link.resolvedNoteId)
                              : onCreateBrokenTarget(link.target)
                          }
                          className={cn(
                            'min-w-0 flex-1 truncate text-left font-mono text-[calc(11.5rem/14)] hover:underline',
                            link.isBroken ? 'text-destructive' : 'text-foreground'
                          )}
                          title={link.target}
                        >
                          [[{link.resolvedTitle || link.target}]]
                        </button>
                        {link.isBroken && (
                          <button
                            type="button"
                            onClick={() => onCreateBrokenTarget(link.target)}
                            title={t('New note')}
                            className="flex shrink-0 items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[calc(11rem/14)] text-foreground hover:bg-accent"
                          >
                            <Plus className="size-3" />
                            {t('Create')}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-1.5 border-border/60 border-t pt-3">
                <p className="font-medium text-muted-foreground">{t('Metadata')}</p>
                <dl className="space-y-1 text-[calc(11.5rem/14)]">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t('Slug')}</dt>
                    <dd className="truncate font-mono">[[{detail.slug}]]</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t('Path')}</dt>
                    <dd className="truncate font-mono">{detail.relPath}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t('Lines')}</dt>
                    <dd className="tabular-nums">{detail.lineCount}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t('Updated')}</dt>
                    <dd className="tabular-nums">{detail.updatedAt.slice(0, 10)}</dd>
                  </div>
                  {detail.generatedBy && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{t('Author')}</dt>
                      <dd className="font-mono">{detail.generatedBy}</dd>
                    </div>
                  )}
                  {detail.sources.length > 0 && (
                    <div className="pt-1">
                      <dt className="mb-1 text-muted-foreground">{t('Sources')}</dt>
                      <dd className="space-y-0.5 font-mono text-[calc(11rem/14)] text-muted-foreground">
                        {detail.sources.map((src) => (
                          <div key={src} className="truncate" title={src}>
                            {src}
                          </div>
                        ))}
                      </dd>
                    </div>
                  )}
                </dl>
              </section>
            </>
          )}
        </div>
      </div>
    </motion.aside>
  );
}
