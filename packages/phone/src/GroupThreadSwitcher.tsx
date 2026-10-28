import { filterThreads, menuThreads } from '@shared/bots/threads';
import { Check, ChevronDown, List, MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { PhoneThreadEntry } from './botState';

export interface GroupThreads {
  entries: PhoneThreadEntry[];
  currentId: string;
  rootId: string;
  /** 不能切换 / 新建的原因（只读、离线、处理中）；列表照常可看 */
  disabledHint?: string;
  onSelect(id: string): void;
  onCreate(): void;
}

function Marks({ entry }: { entry: PhoneThreadEntry }) {
  return (
    <>
      {entry.running && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />}
      <span className="shrink-0 text-muted-foreground text-xs">
        {formatRelativeTime(entry.activityAt, 'zh')}
      </span>
    </>
  );
}

/** 群话题下拉：与桌面一致只列 10 个常用话题，其余进可搜索的「全部话题」 */
export function GroupThreadSwitcher({
  threads,
  status,
}: {
  threads: GroupThreads;
  /** 未在线时附在话题名后的连接状态 */
  status?: string;
}) {
  const [listOpen, setListOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { entries, currentId, rootId, disabledHint } = threads;
  const current = entries.find((entry) => entry.id === currentId);
  const shown = menuThreads(entries, { currentId, rootId });
  const hidden = entries.length - shown.length;
  const found = filterThreads(entries, query, 'all');
  const select = (id: string) => {
    if (!disabledHint && id !== currentId) threads.onSelect(id);
  };

  return (
    <>
      <Menu>
        <MenuTrigger
          aria-label="切换话题"
          className="mt-0.5 flex max-w-full items-center gap-0.5 text-[11px] text-muted-foreground"
        >
          <span className="truncate">
            {current?.title ?? '主话题'}
            {status && ` · ${status}`}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </MenuTrigger>
        <MenuPopup className="w-72 max-w-[calc(100vw-1rem)]">
          <MenuGroup>
            <MenuGroupLabel>话题</MenuGroupLabel>
            {shown.map((entry) => (
              <MenuItem
                key={entry.id}
                disabled={Boolean(disabledHint) && entry.id !== currentId}
                onClick={() => select(entry.id)}
              >
                <Check className={cn(entry.id !== currentId && 'invisible')} />
                <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                <Marks entry={entry} />
              </MenuItem>
            ))}
          </MenuGroup>
          <MenuSeparator />
          {hidden > 0 && (
            <MenuItem
              onClick={() => {
                setQuery('');
                setListOpen(true);
              }}
            >
              <List />
              全部话题（{entries.length}）
            </MenuItem>
          )}
          <MenuItem disabled={Boolean(disabledHint)} onClick={threads.onCreate}>
            <MessageSquarePlus />
            新话题
          </MenuItem>
          {disabledHint && (
            <p className="px-2 py-1.5 text-muted-foreground text-xs">{disabledHint}</p>
          )}
        </MenuPopup>
      </Menu>
      <Sheet open={listOpen} onOpenChange={setListOpen}>
        <SheetContent side="bottom" className="phone-sheet max-h-[80vh] pb-safe">
          <SheetHeader className="px-4 pt-7 pb-4">
            <SheetTitle className="font-semibold text-[15px]">
              全部话题（{entries.length}）
            </SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-2">
            <Input
              value={query}
              placeholder="搜索话题…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {disabledHint && (
            <p className="px-4 pb-2 text-muted-foreground text-xs">{disabledHint}</p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {found.map((entry) => (
              <button
                key={entry.id}
                type="button"
                disabled={Boolean(disabledHint) && entry.id !== currentId}
                onClick={() => {
                  select(entry.id);
                  setListOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent disabled:opacity-60"
              >
                <Check className={cn('h-4 w-4 shrink-0', entry.id !== currentId && 'invisible')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{entry.title}</span>
                  {entry.preview && (
                    <span className="block truncate text-muted-foreground text-xs">
                      {entry.preview}
                    </span>
                  )}
                </span>
                <Marks entry={entry} />
              </button>
            ))}
            {found.length === 0 && (
              <p className="py-8 text-center text-muted-foreground text-sm">没有匹配的话题</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
