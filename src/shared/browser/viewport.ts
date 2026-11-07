import type { BrowserDevice } from '../types/browser';

export function effectiveBrowserViewport(
  device: BrowserDevice | undefined,
  panel: BrowserViewport | null
) {
  const width = device?.enabled ? (device.width ?? 1280) : (panel?.width ?? 1280);
  const height = device?.enabled ? (device.height ?? 800) : (panel?.height ?? 800);
  const fit = panel ? Math.min(panel.width / width, panel.height / height, 1) : 1;
  return {
    width,
    height,
    deviceScaleFactor: device?.enabled ? (device.deviceScaleFactor ?? 1) : 1,
    mobile: device?.enabled ? (device.mobile ?? false) : false,
    touch: device?.enabled ? (device.touch ?? false) : false,
    scale: device?.enabled ? Math.min(device.scale ?? fit, fit) : 1,
  };
}

export interface BrowserViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_DIMENSION = 16384;
const KEYS = ['x', 'y', 'width', 'height'] as const;

/** CSS px → 原生窗口 DIP。按四边取整，避免相邻面板因宽高独立取整而出现缝隙。 */
export function viewportToDip(
  viewport: BrowserViewport | null,
  zoom: number
): BrowserViewport | null {
  if (!viewport || !Number.isFinite(zoom) || zoom <= 0) return null;
  const x = Math.round(viewport.x * zoom);
  const y = Math.round(viewport.y * zoom);
  const right = Math.round((viewport.x + viewport.width) * zoom);
  const bottom = Math.round((viewport.y + viewport.height) * zoom);
  if (
    ![x, y, right, bottom].every(
      (edge) => Number.isSafeInteger(edge) && edge >= 0 && edge <= 2_147_483_647
    )
  )
    return null;
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/** 渲染层报的面板矩形（CSS px）；脏值整体拒绝，DIP 转换由 Main 使用可信缩放率完成。 */
export function parseBrowserViewport(raw: unknown): BrowserViewport | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!Object.keys(record).every((key) => (KEYS as readonly string[]).includes(key))) return null;
  const out = {} as BrowserViewport;
  for (const key of KEYS) {
    const value = record[key];
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > MAX_DIMENSION
    ) {
      return null;
    }
    out[key] = Math.round(value);
  }
  if (out.width <= 0 || out.height <= 0) return null;
  return out;
}
