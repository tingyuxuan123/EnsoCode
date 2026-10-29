/** data: 不经过 fetch（CSP connect-src 不放行），本地协议与外链沿用浏览器安全检查。 */
async function imageBlob(src: string): Promise<Blob> {
  if (src.startsWith('data:')) {
    const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(src);
    if (!match?.[2]) throw new Error('Invalid image data URL');
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: match[1].toLowerCase() });
  }
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Could not load image (${response.status})`);
  return response.blob();
}

/** Chromium 剪贴板仅稳定支持 PNG；非 PNG 用 bitmap 解码，不支持的 SVG 安全失败。 */
export async function copyImageToClipboard(src: string): Promise<void> {
  const blob = await imageBlob(src);
  let png = blob;
  if (blob.type !== 'image/png') {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create image canvas context');
      context.drawImage(bitmap, 0, 0);
      png = await canvas.convertToBlob({ type: 'image/png' });
    } finally {
      bitmap.close();
    }
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
