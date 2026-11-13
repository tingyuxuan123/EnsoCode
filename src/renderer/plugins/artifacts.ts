export function artifactPreviewKind(mime: string): 'text' | 'image' | 'file' {
  const lower = mime.toLowerCase();
  if (/^image\/(png|jpeg|gif|webp|bmp|avif)$/.test(lower)) return 'image';
  if (
    lower.startsWith('text/') ||
    ['application/json', 'application/javascript', 'application/xml'].includes(lower) ||
    lower.endsWith('+json') ||
    lower.endsWith('+xml')
  )
    return 'text';
  return 'file';
}
