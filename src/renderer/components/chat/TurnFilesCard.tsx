import { ChevronDown, FileCode2, Files } from 'lucide-react';
import { createContext, useContext, useState } from 'react';
import { useI18n } from '@/i18n';
import { openSidePanelFile } from '@/lib/sidePanelDock';
import { cn } from '@/lib/utils';
import type { TurnFileSummary } from './turnFileChanges';

/** 默认展示的文件数；其余收进「还有 N 个文件」 */
const PREVIEW_COUNT = 3;

/**
 * 一轮最终回复下方的「本轮改动」卡片数据：键为该回复的消息绝对下标。
 * 本机主聊天提供；其它宿主（Bot、远程节点、子代理观察面板）不提供即不显示。
 */
export const TurnFilesContext = createContext<{
  conversationId: string;
  summaries: ReadonlyMap<number, TurnFileSummary>;
} | null>(null);

export function TurnFilesFooter({ messageIndex }: { messageIndex: number }) {
  const context = useContext(TurnFilesContext);
  const summary = context?.summaries.get(messageIndex);
  if (!context || !summary) return null;
  return <TurnFilesCard conversationId={context.conversationId} summary={summary} />;
}

function splitPath(path: string): { dir: string; name: string } {
  const index = path.lastIndexOf('/');
  return index < 0
    ? { dir: '', name: path }
    : { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}

export function TurnFilesCard({
  conversationId,
  summary,
}: {
  conversationId: string;
  summary: TurnFileSummary;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const total = summary.added + summary.removed;
  const hidden = Math.max(0, summary.files.length - PREVIEW_COUNT);
  const shown = expanded ? summary.files : summary.files.slice(0, PREVIEW_COUNT);
  return (
    <section
      data-turn-files=""
      className="my-[16px] overflow-hidden rounded-[6px] border border-line text-[calc(12rem/14)]"
    >
      <header className="flex h-[calc(36rem/14)] items-center gap-[8px] bg-muted/60 px-[12px]">
        <Files className="size-[calc(14rem/14)] shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-medium text-foreground">
          {t('{{count}} files changed', { count: summary.files.length })}
        </span>
        <span className="ml-auto flex items-center gap-2 tabular-nums">
          {summary.added > 0 && <span className="text-success">+{summary.added}</span>}
          {summary.removed > 0 && <span className="text-destructive">-{summary.removed}</span>}
          {total > 0 && (
            <span
              aria-hidden
              className="flex h-1.5 w-12 overflow-hidden rounded-full bg-muted"
              title={`+${summary.added} -${summary.removed}`}
            >
              <span
                className="h-full bg-success"
                style={{ width: `${(summary.added / total) * 100}%` }}
              />
              <span
                className="h-full bg-destructive"
                style={{ width: `${(summary.removed / total) * 100}%` }}
              />
            </span>
          )}
        </span>
      </header>
      <ul className="divide-y divide-line border-t border-line">
        {shown.map((file) => {
          const { dir, name } = splitPath(file.path);
          return (
            <li key={file.path}>
              <button
                type="button"
                data-turn-file={file.path}
                title={file.path}
                onClick={() => openSidePanelFile(conversationId, file.path)}
                className="flex h-[calc(36rem/14)] w-full min-w-0 items-center gap-[8px] px-[12px] text-left transition-colors hover:bg-accent"
              >
                <FileCode2 className="size-[calc(14rem/14)] shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  {dir && <span className="text-muted-foreground">{dir}</span>}
                  <span className="font-medium text-foreground">{name}</span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {file.added > 0 && <span className="text-success">+{file.added}</span>}
                  {file.removed > 0 && (
                    <span className="ml-1.5 text-destructive">-{file.removed}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          data-turn-files-more=""
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full items-center gap-1 border-t px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          {expanded ? t('Show less') : t('{{count}} more files', { count: hidden })}
          <ChevronDown
            className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')}
            aria-hidden
          />
        </button>
      )}
    </section>
  );
}
