/**
 * 手机侧：把时间线里的图片绝对路径换成「工作区相对路径」再上行。
 * 手机不上传磁盘路径本身——Main 只按 sessionId 的权威根 + 相对路径解析。
 * 不在会话执行目录内（含 UNC / 盘符不一致 / `..`）一律 null，交给上层显示失败态。
 */
export function toWorkspaceRelPath(target: string, cwd?: string): string | null {
  if (!target || !cwd) return null;
  const norm = (value: string): string => value.replace(/\\/g, '/');
  const t = norm(target);
  const root = norm(cwd).replace(/\/+$/, '');
  if (!root) return null;
  // UNC（//server/share）两边都可能连网络共享，不做猜测
  if (t.startsWith('//') || root.startsWith('//')) return null;
  const windows = /^[a-zA-Z]:/.test(root) || /^[a-zA-Z]:/.test(t);
  if (windows && !/^[a-zA-Z]:\//.test(t)) return null;
  if (!windows && !t.startsWith('/')) return null;
  const same = windows
    ? (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
    : (a: string, b: string) => a === b;
  const prefix = `${root}/`;
  if (t.length <= prefix.length || !same(t.slice(0, prefix.length), prefix)) return null;
  const rel = t.slice(prefix.length);
  if (!rel || rel.includes('\0')) return null;
  if (rel.split('/').some((part) => part === '' || part === '.' || part === '..')) return null;
  return rel;
}
