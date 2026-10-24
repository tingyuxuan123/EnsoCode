import { fileChangeKeys } from '@/lib/fileChangeKeys';
import { type TimelineItem, toProjectRelativePath } from '@/stores/sessions/timeline';
import { lineDelta, toolLineDelta } from './toolLineDelta';

type ToolItem = Extract<TimelineItem, { kind: 'tool' }>;

export interface TurnFileChange {
  path: string;
  added: number;
  removed: number;
}

export interface TurnFileSummary {
  added: number;
  removed: number;
  /** 按改动量（增+删）降序；同量按路径 */
  files: TurnFileChange[];
}

/** 行 key `${absIndex}-${part}` 的消息绝对下标，与 turnFooter 的参数同源 */
const messageIndexOf = (key: string): number => Number(key.split('-')[0]);

function* toolRows(items: readonly TimelineItem[]): Generator<ToolItem> {
  for (const item of items) {
    if (item.kind === 'tool') yield item;
    else if (item.kind === 'tool-group') yield* toolRows(item.children);
  }
}

/**
 * 每轮结束时按文件汇总本轮工具改动（edit / write / apply_patch，真正落盘的才算）。
 * 键为该轮最终回复所在消息的绝对下标（turnFooter 的参数）；没改文件、未结束的轮没有条目。
 * bash 等命令改的文件不计——与 ZCode 同口径，只认工具写盘。
 */
export function turnFileChanges(
  items: readonly TimelineItem[],
  cwd?: string
): Map<number, TurnFileSummary> {
  const result = new Map<number, TurnFileSummary>();
  let pending = new Map<string, TurnFileChange>();
  const add = (path: string, added: number, removed: number) => {
    if (!path) return;
    const current = pending.get(path) ?? { path, added: 0, removed: 0 };
    current.added += added;
    current.removed += removed;
    pending.set(path, current);
  };
  for (const item of items) {
    if (item.kind === 'user') {
      pending = new Map();
      continue;
    }
    if (item.kind === 'tool' || item.kind === 'tool-group') {
      const tools = [...toolRows([item])];
      const landed = fileChangeKeys(tools);
      for (const tool of tools) {
        if (!landed.has(tool.key)) continue;
        if (tool.name === 'apply_patch') {
          for (const change of tool.fileChanges ?? []) {
            const delta = lineDelta(change.oldText, change.newText);
            add(toProjectRelativePath(change.path, cwd), delta.added, delta.removed);
          }
          continue;
        }
        const delta = toolLineDelta(tool);
        if (delta) add(tool.summary, delta.added, delta.removed);
      }
      continue;
    }
    if (item.kind === 'text' && item.turnEnd && !item.streaming) {
      if (pending.size > 0) {
        const files = [...pending.values()].sort(
          (a, b) => b.added + b.removed - (a.added + a.removed) || a.path.localeCompare(b.path)
        );
        result.set(messageIndexOf(item.key), {
          added: files.reduce((sum, file) => sum + file.added, 0),
          removed: files.reduce((sum, file) => sum + file.removed, 0),
          files,
        });
      }
      pending = new Map();
    }
  }
  return result;
}
