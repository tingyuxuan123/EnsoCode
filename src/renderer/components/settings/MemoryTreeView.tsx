import type { TreeNodeDto } from '@shared/memory/graphDto';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/i18n';

/**
 * 知识树：按 type / status / space 分组折叠浏览，点击笔记打开详情。
 */
export function MemoryTreeView({
  tree,
  loading,
  onSelectNote,
}: {
  tree: TreeNodeDto[];
  loading: boolean;
  onSelectNote: (noteId: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState<ReadonlySet<string>>(new Set());

  if (tree.length === 0) {
    return (
      <p className="rounded-[6px] border px-3 py-6 text-muted-foreground text-[calc(13rem/14)]">
        {loading ? t('Loading…') : t('No wiki notes yet.')}
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-[6px] border">
      {tree.map((group) => {
        const expanded = open.has(group.id);
        return (
          <li key={group.id}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-accent/40"
              onClick={() => {
                const next = new Set(open);
                if (!next.delete(group.id)) next.add(group.id);
                setOpen(next);
              }}
            >
              <span className="flex min-w-0 items-center gap-2 text-[calc(13rem/14)]">
                <span className="text-muted-foreground">{expanded ? '▾' : '▸'}</span>
                <span className="truncate font-medium">{group.label}</span>
                <Badge variant="secondary">{group.count}</Badge>
              </span>
            </button>
            {expanded && (
              <ul className="divide-y border-t bg-muted/20">
                {(group.children ?? []).map((child) => (
                  <li key={child.id}>
                    <button
                      type="button"
                      disabled={!child.noteId}
                      onClick={() => child.noteId && onSelectNote(child.noteId)}
                      className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left hover:bg-accent/50"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[calc(13rem/14)]">{child.label}</span>
                        {child.slug && (
                          <span className="truncate font-mono text-muted-foreground text-[calc(11rem/14)]">
                            [[{child.slug}]]
                          </span>
                        )}
                      </span>
                      {child.status && (
                        <Badge variant={child.status === 'verified' ? 'secondary' : 'outline'}>
                          {t(
                            child.status === 'verified'
                              ? 'Verified'
                              : child.status === 'draft'
                                ? 'Draft'
                                : 'Deprecated'
                          )}
                        </Badge>
                      )}
                    </button>
                  </li>
                ))}
                {group.count > (group.children?.length ?? 0) && (
                  <li className="px-4 py-2 text-muted-foreground text-[calc(12rem/14)]">
                    {t('Showing {{shown}} of {{total}}', {
                      shown: String(group.children?.length ?? 0),
                      total: String(group.count),
                    })}
                  </li>
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
