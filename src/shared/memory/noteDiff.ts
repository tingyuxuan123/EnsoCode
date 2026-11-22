/** 笔记改动的紧凑展示：只保留变化块，避免把整页塞进回执。 */
export const NOTE_DIFF_MAX_LINES = 40;
export const NOTE_DIFF_MAX_CHARS = 4000;

export interface NoteDiff {
  /** 形如 `-旧行\n+新行\n 上下文`；首尾未变化的部分已经裁掉 */
  patch: string;
  added: number;
  removed: number;
  /** 裁掉的行数（前后上下文），给 UI 提示“还有更多” */
  truncated: boolean;
}

const lines = (value: string): string[] =>
  value.trim() ? value.replace(/\r\n/g, '\n').split('\n') : [];

export function noteDiff(before: string, after: string): NoteDiff | null {
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  const removed = a.slice(start, endA + 1);
  const added = b.slice(start, endB + 1);
  if (removed.length === 0 && added.length === 0) return null;

  // 上下文各留一行，方便看出改在哪个小节
  const contextBefore = start > 0 ? [a[start - 1]!] : [];
  const contextAfter = endA + 1 < a.length ? [a[endA + 1]!] : [];
  const rows = [
    ...contextBefore.map((text) => ` ${text}`),
    ...removed.map((text) => `-${text}`),
    ...added.map((text) => `+${text}`),
    ...contextAfter.map((text) => ` ${text}`),
  ];
  const kept = rows.slice(0, NOTE_DIFF_MAX_LINES);
  const patch = kept.join('\n').slice(0, NOTE_DIFF_MAX_CHARS);
  return {
    patch,
    added: added.length,
    removed: removed.length,
    truncated: kept.length < rows.length || patch.length < kept.join('\n').length,
  };
}
