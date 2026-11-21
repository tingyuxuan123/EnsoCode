export const COMPUTER_PREVIEW_WINDOW_TITLE = '__enso_computer_preview__';
export const COMPUTER_OCCUPANCY_WINDOW_TITLE = '__enso_computer_occupancy__';

const internalWindowIds = new Set<string>();

/** 从 Electron mediaSourceId（形如 window:1590:0）提取原生窗口 ID。 */
export function parseMediaSourceWindowId(mediaSourceId: string | undefined): string | undefined {
  if (!mediaSourceId) return undefined;
  const match = /^window:(\d+):/u.exec(mediaSourceId);
  return match?.[1];
}

export function registerComputerInternalWindowId(windowId: string | undefined): void {
  if (windowId) internalWindowIds.add(windowId);
}

export function unregisterComputerInternalWindowId(windowId: string | undefined): void {
  if (windowId) internalWindowIds.delete(windowId);
}

export function isComputerInternalWindow(window: { id?: string; title?: string }): boolean {
  if (
    window.title === COMPUTER_PREVIEW_WINDOW_TITLE ||
    window.title === COMPUTER_OCCUPANCY_WINDOW_TITLE
  ) {
    return true;
  }
  if (!window.id) return false;
  if (internalWindowIds.has(window.id)) return true;
  const mediaWindowId = parseMediaSourceWindowId(window.id);
  return mediaWindowId !== undefined && internalWindowIds.has(mediaWindowId);
}

/** 登记并跟踪 computer 内部辅助窗口，在窗口销毁后解除登记。 */
export function trackComputerInternalWindow(win: {
  getMediaSourceId?: () => string;
  once: (event: 'closed', listener: () => void) => unknown;
}): void {
  let id: string | undefined;
  try {
    id = parseMediaSourceWindowId(win.getMediaSourceId?.());
  } catch {
    id = undefined;
  }
  registerComputerInternalWindowId(id);
  win.once('closed', () => unregisterComputerInternalWindowId(id));
}

export function isListedCgWindowLayer(layer: number): boolean {
  return layer >= 0 && layer <= 8;
}

export function findCapturerWindowSource<T extends { id: string }>(
  sources: T[],
  target: string
): T | undefined {
  return sources.find(
    (item) =>
      item.id === target || item.id.endsWith(`:${target}:0`) || item.id.includes(`:${target}:`)
  );
}

export function thumbnailCropForWindow(input: {
  window: { x: number; y: number; width: number; height: number };
  display: { x: number; y: number; width: number; height: number };
  thumbnailWidth: number;
  thumbnailHeight: number;
}): { x: number; y: number; width: number; height: number } | undefined {
  if (
    input.display.width <= 0 ||
    input.display.height <= 0 ||
    input.window.width <= 0 ||
    input.window.height <= 0
  ) {
    return undefined;
  }
  const scaleX = input.thumbnailWidth / input.display.width;
  const scaleY = input.thumbnailHeight / input.display.height;
  const x = Math.max(0, Math.round((input.window.x - input.display.x) * scaleX));
  const y = Math.max(0, Math.round((input.window.y - input.display.y) * scaleY));
  if (x >= input.thumbnailWidth || y >= input.thumbnailHeight) return undefined;
  return {
    x,
    y,
    width: Math.max(1, Math.min(input.thumbnailWidth - x, Math.round(input.window.width * scaleX))),
    height: Math.max(
      1,
      Math.min(input.thumbnailHeight - y, Math.round(input.window.height * scaleY))
    ),
  };
}
