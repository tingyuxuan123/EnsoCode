import { makeNoteId } from '@shared/memory/markdown';
import type { ProjectedMemoryUpdate } from '@shared/types/agent';
import { BookMarked, ChevronDown } from 'lucide-react';
import { createContext, useContext, useState } from 'react';
import { useWikiWorkspaceStore } from '@/features/wiki/store';
import { useI18n } from '@/i18n';

/** 折叠展示的条数；其余收进「还有 N 条」 */
const PREVIEW_COUNT = 3;

function DiffBlock({ patch }: { patch: string }) {
  // 纯展示：把补丁行拼成带符号的文本，避免为每一行生成 key。
  const rows = patch.split('\n');
  return (
    <pre className="max-h-[240px] overflow-auto border-t bg-muted/30 px-[12px] py-[8px] font-mono text-[calc(11.5rem/14)] leading-[calc(17rem/14)]">
      {rows.map((line) => (
        <div
          className={
            line.startsWith('+')
              ? 'text-success'
              : line.startsWith('-')
                ? 'text-destructive'
                : 'text-muted-foreground'
          }
        >
          {line || ' '}
        </div>
      ))}
    </pre>
  );
}

/** 一条记忆改动：点标题打开右侧 Wiki；有 diff 时可在原位展开看改了什么。 */
function MemoryRow({ update }: { update: ProjectedMemoryUpdate }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex items-center gap-[8px] px-[12px] py-[8px] hover:bg-muted/50">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-[8px] text-left"
          title={update.relPath}
          onClick={() =>
            useWikiWorkspaceStore.getState().openNote(makeNoteId(update.spaceId, update.relPath))
          }
        >
          <span className="shrink-0 text-muted-foreground">
            {t(update.status === 'created' ? 'New' : 'Updated')}
          </span>
          <span className="min-w-0 flex-1 truncate">{update.title ?? update.relPath}</span>
          <span className="shrink-0 truncate text-muted-foreground">{update.relPath}</span>
        </button>
        {update.diff && (
          <>
            <span className="shrink-0 tabular-nums text-success">+{update.diff.added}</span>
            <span className="shrink-0 tabular-nums text-destructive">-{update.diff.removed}</span>
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              <ChevronDown
                className={open ? 'size-[calc(12rem/14)] rotate-180' : 'size-[calc(12rem/14)]'}
              />
            </button>
          </>
        )}
      </div>
      {open && update.diff && <DiffBlock patch={update.diff.patch} />}
    </div>
  );
}

/**
 * 每轮回答下方「记忆已更新」卡片的数据：键为回复消息的绝对下标（与文件卡同源）。
 * 只在本机主聊天提供；其它宿主不提供即不显示。
 */
export const TurnMemoryContext = createContext<ReadonlyMap<
  number,
  readonly ProjectedMemoryUpdate[]
> | null>(null);

export function TurnMemoryFooter({ messageIndex }: { messageIndex: number }) {
  const updates = useContext(TurnMemoryContext)?.get(messageIndex);
  if (!updates || updates.length === 0) return null;
  return <TurnMemoryCard updates={updates} />;
}

/**
 * 一轮回答下方的「记忆已更新」卡片：收尾整理写入的 Wiki 页。
 * 与「文件已修改」同构，但记忆写入本身不上屏，避免顶掉真答案。
 */
export function TurnMemoryCard({ updates }: { updates: readonly ProjectedMemoryUpdate[] }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const hidden = Math.max(0, updates.length - PREVIEW_COUNT);
  const shown = expanded ? updates : updates.slice(0, PREVIEW_COUNT);
  return (
    <section
      data-turn-memory=""
      className="my-[16px] overflow-hidden rounded-[6px] border border-line text-[calc(12rem/14)]"
    >
      <header className="flex h-[calc(36rem/14)] items-center gap-[8px] bg-muted/60 px-[12px]">
        <BookMarked className="size-[calc(14rem/14)] shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-medium text-foreground">
          {t('{{count}} wiki notes updated', { count: updates.length })}
        </span>
      </header>
      <ul className="divide-y">
        {shown.map((update) => (
          <li key={`${update.spaceId}::${update.relPath}`}>
            {/* 只传 note id，路径由 Main 按空间推导。 */}
            <MemoryRow update={update} />
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          className="flex w-full items-center gap-[6px] border-t px-[12px] py-[8px] text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown
            className={expanded ? 'size-[calc(12rem/14)] rotate-180' : 'size-[calc(12rem/14)]'}
            aria-hidden
          />
          {expanded
            ? t('Show less')
            : t('{{count}} more', { count: String(updates.length - PREVIEW_COUNT) })}
        </button>
      )}
    </section>
  );
}
