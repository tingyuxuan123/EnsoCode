import type { TimelineItem } from '@/stores/sessions/timeline';

type ToolItem = Extract<TimelineItem, { kind: 'tool' }>;

const splitLines = (text: string): string[] =>
  text === '' ? [] : text.replace(/\n$/, '').split('\n');

/**
 * 两段文本的增删行数：按行多重集合相减。摘要行只要一个量级，
 * 不跑完整 LCS（流式期间每次刷新都要算），移动的行不计入增删。
 */
export function lineDelta(oldText: string, newText: string): { added: number; removed: number } {
  const counts = new Map<string, number>();
  for (const line of splitLines(oldText)) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of splitLines(newText)) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else added += 1;
  }
  let removed = 0;
  for (const left of counts.values()) removed += left;
  return { added, removed };
}

/** 工具行摘要尾部的 +N/-N：edit 的块、write 的内容、apply_patch 的文件变更 */
export function toolLineDelta(item: ToolItem): { added: number; removed: number } | null {
  let added = 0;
  let removed = 0;
  let any = false;
  for (const block of item.edits ?? []) {
    const delta = lineDelta(block.oldText, block.newText);
    added += delta.added;
    removed += delta.removed;
    any = true;
  }
  for (const change of item.fileChanges ?? []) {
    const delta = lineDelta(change.oldText, change.newText);
    added += delta.added;
    removed += delta.removed;
    any = true;
  }
  if (!any && item.writeContent) {
    added = splitLines(item.writeContent).length;
    any = true;
  }
  return any ? { added, removed } : null;
}
