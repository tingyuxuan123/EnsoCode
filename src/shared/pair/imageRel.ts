/**
 * 会话图片请求的路径口径（Main 与手机共用，纯字符串、无 node 依赖）：
 * 手机只能报工作区相对路径；绝对路径、盘符、UNC、反斜杠、NUL 与 `..` 一律拒绝，
 * 绝对路径由 Main 按权威根解析，手机不能借这条通道读任意磁盘位置。
 */
export function normalizeSessionImageRel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value || value.length > 4096) return null;
  if (value.includes('\\') || value.includes('\0')) return null;
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return null;
  const parts = value.split('/');
  if (parts.some((part) => part === '..')) return null;
  const clean = parts.filter((part) => part !== '' && part !== '.').join('/');
  return clean || null;
}
