/**
 * read 找不到文件：猜测性探路的常态结果，界面上与真正的失败分开显示。
 * 认 agent 层改写后的 `File not found:` 与历史会话里 pi 的原始 ENOENT 两种文本。
 */
const MISSING_FILE = /^(?:File not found: |ENOENT: no such file or directory)/;

export function isMissingFileRead(item: {
  name: string;
  state: string;
  output: string | null;
}): boolean {
  return (
    item.name === 'read' && item.state === 'error' && MISSING_FILE.test(item.output?.trim() ?? '')
  );
}
