import { Eye } from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import { useScrollChain } from '@/hooks/useScrollChain';
import { useI18n } from '@/i18n';
import { ListFilterBar, matchesFilter } from './ListFilterBar';

export function setFilteredIds(
  current: string[],
  filteredIds: string[],
  selected: boolean
): string[] {
  if (filteredIds.length === 0) return current;
  const vis = new Set(filteredIds);
  if (selected) {
    const extra = filteredIds.filter((id) => !current.includes(id));
    return extra.length === 0 ? current : [...current, ...extra];
  }
  const next = current.filter((id) => !vis.has(id));
  return next.length === current.length ? current : next;
}

/** 带搜索的可勾选列表：每项 checkbox + 名字 + 来源角标 + 眼睛（居中 detail 弹窗） */
export function PickList<T extends { id: string }>({
  title,
  emptyText,
  items,
  getName,
  getSource,
  isChecked,
  onToggle,
  onSetFiltered,
  placeholder,
  renderDetail,
  leading,
}: {
  title: string;
  emptyText: string;
  items: T[];
  getName: (item: T) => string;
  getSource?: (item: T) => string;
  isChecked: (item: T) => boolean;
  onToggle: (item: T) => void;
  onSetFiltered?: (ids: string[], selected: boolean) => void;
  placeholder?: string;
  renderDetail: (item: T) => React.ReactNode;
  leading?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [query, setQuery] = React.useState('');
  const [detail, setDetail] = React.useState<T | null>(null);
  const filtered = items.filter((item) => matchesFilter(query, [getName(item), getSource?.(item)]));
  const filteredIds = filtered.map((item) => item.id);
  const listRef = useScrollChain<HTMLDivElement>();
  const selectedCount = filtered.filter(isChecked).length;
  const allSelected = filtered.length > 0 && selectedCount === filtered.length;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <div>
      <p className="mb-1 text-[calc(12rem/14)] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      <div className="rounded-[6px] border">
        {items.length > 0 && (
          <div className="border-b p-1.5">
            <ListFilterBar
              query={query}
              onQueryChange={setQuery}
              placeholder={placeholder ?? t('Search')}
              allSelected={allSelected}
              someSelected={someSelected}
              onToggleSelectAll={
                onSetFiltered ? (selected) => onSetFiltered(filteredIds, selected) : undefined
              }
              onEnable={onSetFiltered ? () => onSetFiltered(filteredIds, true) : undefined}
              onDisable={onSetFiltered ? () => onSetFiltered(filteredIds, false) : undefined}
              selectDisabled={filtered.length === 0}
              actionDisabled={filtered.length === 0}
            />
          </div>
        )}

        {/* 限高滚动；到边界后 useScrollChain 把滚轮交给外层 */}
        <div ref={listRef} className="max-h-40 overflow-y-auto p-1.5">
          {leading}
          {items.length === 0 && <Empty text={emptyText} />}
          {items.length > 0 && filtered.length === 0 && <Empty text={t('No results')} />}
          {filtered.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted"
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <Checkbox checked={isChecked(item)} onCheckedChange={() => onToggle(item)} />
                <span className="min-w-0 flex-1 truncate text-[calc(13rem/14)]">
                  {getName(item)}
                </span>
                {getSource && (
                  <Badge variant="secondary" className="shrink-0 text-[calc(11rem/14)]">
                    {getSource(item)}
                  </Badge>
                )}
              </label>
              <button
                type="button"
                onClick={() => setDetail(item)}
                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-lg" zIndexLevel="nested">
          <DialogHeader>
            <DialogTitle>{detail ? getName(detail) : ''}</DialogTitle>
          </DialogHeader>
          <DialogPanel>{detail && renderDetail(detail)}</DialogPanel>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function DetailRows({ rows }: { rows: [string, string | undefined][] }) {
  return (
    <div className="space-y-2 text-[calc(12rem/14)]">
      {rows
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label}>
            <p className="font-semibold text-muted-foreground">{label}</p>
            <p className="mt-0.5 break-words whitespace-pre-wrap">{value}</p>
          </div>
        ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-2 text-[calc(12rem/14)] text-muted-foreground">{text}</p>;
}
