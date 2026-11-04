/** SDK-only local paths. Main filesystem authority must keep its native realpath. */
export function validateDesignAbsolutePath(path: string): string {
  if (
    (!path.startsWith('/') && !/^[A-Z]:\//.test(path)) ||
    path.startsWith('//') ||
    /^\/[A-Za-z]:(?:\/|$)/.test(path) ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((part) => part === '..' || part === '.')
  ) {
    throw new Error(`Design path is not a canonical local absolute path: ${path}`);
  }
  if (/^[A-Z]:\/+$/.test(path)) return `${path.slice(0, 2)}/`;
  return path.replace(/\/+$/, '') || '/';
}

/** Normalize only the resolveRoot reply, never an arbitrary Renderer-supplied path. */
export function toDesignSdkPath(nativePath: string): string {
  const path = /^[A-Za-z]:[\\/]/.test(nativePath)
    ? nativePath[0].toUpperCase() + nativePath.slice(1).replace(/\\/g, '/')
    : nativePath;
  return validateDesignAbsolutePath(path);
}
