import { type CodeViewDiffItem, type FileDiffMetadata, parseDiffFromFile } from '@pierre/diffs';
import { diffCacheKey } from './diffCacheKey';
import { fileLanguage } from './fileLanguage';
import type { SessionChangeFile } from './sessionChanges';

interface MemoEntry {
  oldText: string;
  newText: string;
  collapsed: boolean;
  version: number;
  fileDiff: FileDiffMetadata;
}

/** 按 item id 记住上次的内容/折叠态/version；CodeView 只在 version 变时才更新 item */
export type ChangeItemMemo = Map<string, MemoEntry>;

export function buildChangeItems(
  files: SessionChangeFile[],
  collapsedIds: ReadonlySet<string>,
  memo: ChangeItemMemo
): CodeViewDiffItem[] {
  const seen = new Set<string>();
  const items = files.map((file) => {
    const id = `diff:${file.path}`;
    seen.add(id);
    const collapsed = collapsedIds.has(id);
    const prev = memo.get(id);
    const contentChanged = !prev || prev.oldText !== file.oldText || prev.newText !== file.newText;
    const fileDiff =
      contentChanged || !prev
        ? parseDiffFromFile(
            { name: file.path, contents: file.oldText, lang: fileLanguage(file.path) },
            { name: file.path, contents: file.newText, lang: fileLanguage(file.path) }
          )
        : prev.fileDiff;
    if (contentChanged || !prev)
      fileDiff.cacheKey = diffCacheKey(file.path, file.oldText, file.newText);
    const version = !prev
      ? 0
      : contentChanged || prev.collapsed !== collapsed
        ? prev.version + 1
        : prev.version;
    memo.set(id, { oldText: file.oldText, newText: file.newText, collapsed, version, fileDiff });
    return { id, type: 'diff' as const, fileDiff, version, collapsed };
  });
  for (const id of memo.keys()) if (!seen.has(id)) memo.delete(id);
  return items;
}
