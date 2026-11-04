import { DesignServiceError } from './errors';

/** The subset of Electron's NativeImage that encoding needs; kept structural for tests. */
export interface CapturedImage {
  isEmpty(): boolean;
  getScaleFactors(): number[];
  toPNG(options?: { scaleFactor?: number }): Buffer;
  toJPEG(quality: number): Buffer;
}

/**
 * Windows 上 `show:false` 的窗口不向合成器出帧，CDP `Page.captureScreenshot`
 * (fromSurface) 会一直挂起直到超时；`webContents.capturePage()` 走 Viz 直接拷贝，
 * 隐藏窗口也能拿到真实画面。macOS/Linux 保持已验证的 CDP 路径。
 */
export function prefersNativeCapture(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32';
}

export function encodeCapturedImage(
  image: CapturedImage,
  format: 'png' | 'jpeg',
  quality?: number
): string {
  if (image.isEmpty()) throw new DesignServiceError('FAILED', 'Capture returned no image');
  const bytes =
    format === 'png'
      ? image.toPNG({ scaleFactor: Math.max(1, ...image.getScaleFactors()) })
      : image.toJPEG(Math.max(1, Math.round((quality ?? 0.92) * 100)));
  return bytes.toString('base64');
}
