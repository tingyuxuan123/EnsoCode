import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import type { MemoryCaptureView, MemorySearchHit } from './memorySearchHits';

export function MemorySearchResults({
  hits,
  defaultOpen = false,
}: {
  hits: MemorySearchHit[];
  defaultOpen?: boolean;
}) {
  const { t } = useI18n();
  if (hits.length === 0) {
    return (
      <p className="px-3 py-2 text-[calc(11rem/14)] text-muted-foreground">{t('No results')}</p>
    );
  }
  return (
    <ul className="divide-y divide-border/60">
      {hits.map((hit) => (
        <MemoryHitRow key={hit.id} hit={hit} defaultOpen={defaultOpen} />
      ))}
    </ul>
  );
}

/** memory_upsert：写入/更新的那条直接展开；Bot 写共享空间待审时标出提示 */
export function MemoryCaptureResult({ view }: { view: MemoryCaptureView }) {
  const { t } = useI18n();
  const note = view.written
    ? view.action === 'updated'
      ? t('Updated existing wiki note')
      : null
    : t('Queued for approval in Inbox');
  return (
    <>
      {note && <p className="px-3 pt-2 text-[calc(11rem/14)] text-muted-foreground">{note}</p>}
      <MemorySearchResults hits={[view.memory]} defaultOpen />
    </>
  );
}

function MemoryHitRow({ hit, defaultOpen }: { hit: MemorySearchHit; defaultOpen: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={(event) => {
          const selection = window.getSelection();
          if (selection?.toString() && event.currentTarget.contains(selection.anchorNode)) return;
          setOpen((v) => !v);
        }}
        className="block w-full cursor-pointer px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'min-w-0 flex-1 font-medium text-foreground text-[calc(11rem/14)]',
              open ? 'break-words' : 'truncate'
            )}
          >
            {hit.title}
          </span>
          {hit.noteType && (
            <Badge variant="secondary" size="sm">
              {hit.noteType}
            </Badge>
          )}
          {hit.status && (
            <Badge variant="outline" size="sm">
              {t(
                hit.status === 'verified'
                  ? 'Verified'
                  : hit.status === 'draft'
                    ? 'Draft'
                    : 'Deprecated'
              )}
            </Badge>
          )}
          {hit.space && (
            <Badge variant="outline" size="sm">
              {t(hit.space === 'global' ? 'Global' : 'Project')}
            </Badge>
          )}
        </span>
        {hit.slug && (
          <span className="block truncate font-mono text-[calc(10rem/14)] text-muted-foreground/80">
            [[{hit.slug}]]
          </span>
        )}
        <span
          className={cn(
            'mt-0.5 whitespace-pre-wrap break-words text-muted-foreground text-[calc(11rem/14)] leading-relaxed',
            open ? 'block' : 'line-clamp-2'
          )}
        >
          {hit.content}
        </span>
      </button>
    </li>
  );
}
