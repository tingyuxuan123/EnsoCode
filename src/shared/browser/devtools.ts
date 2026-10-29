/** DevTools 前端占着 guest 时不能再 attach debugger（Electron 互斥）。 */
export const DEVTOOLS_BUSY_ERROR = 'DevTools is open; close it to use browser CDP / screenshots.';

export function assertDevtoolsIdle(devtoolsOpen: boolean): void {
  if (devtoolsOpen) throw new Error(DEVTOOLS_BUSY_ERROR);
}

export type DevtoolsDockSide = 'bottom' | 'right' | 'left' | 'undocked';

export interface DevtoolsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DevtoolsDockMessage =
  | { side: DevtoolsDockSide }
  | { bounds: DevtoolsRect }
  | { closed: true };

const DOCK_TAG = '__enso_devtools_dock__';
const SIDES: readonly DevtoolsDockSide[] = ['bottom', 'right', 'left', 'undocked'];
const MAX_DIMENSION = 16384;

/**
 * Electron 不把 DevTools 前端的停靠方向、网页区域和自带关闭按钮转给宿主；
 * 注入脚本把它们以 console.debug 带固定前缀发回。脏值整体丢弃。
 */
export const DEVTOOLS_DOCK_BRIDGE_SCRIPT = `(() => {
  if (globalThis.__ensoDockBridge) return;
  globalThis.__ensoDockBridge = true;
  const api = globalThis.DevToolsAPI;
  if (!api || typeof api.sendMessageToEmbedder !== 'function') return;
  const emit = (payload) => console.debug(${JSON.stringify(DOCK_TAG)} + JSON.stringify(payload));
  const original = api.sendMessageToEmbedder.bind(api);
  api.sendMessageToEmbedder = (method, args, callback) => {
    try {
      if (method === 'closeWindow') {
        // 自定义前端的原生关闭不会可靠触发 guest 的 devtools-closed；
        // 让 Main 统一关闭、销毁和恢复布局，不交给 Electron 单独拆掉前端。
        emit({ closed: true });
        return;
      } else if (method === 'setInspectedPageBounds' && args && args[0]) {
        const b = args[0];
        emit({ bounds: { x: b.x, y: b.y, width: b.width, height: b.height } });
      } else if (method === 'setPreference' && args && args[0] === 'currentDockState') {
        const side = JSON.parse(args[1]);
        emit({ side });
        // 不把独立窗口记成偏好：下次打开前端会在脚本注入前就 undock，Electron 会另开空白窗口
        if (side === 'undocked') return;
      } else if (method === 'setIsDocked' && args && args[0] === false) {
        // Electron 收到 undock 会自建一扇原生 DevTools 窗口；独立窗口由宿主自己开，这里直接应答
        if (typeof callback === 'function') callback();
        return;
      }
    } catch {}
    return original(method, args, callback);
  };
  // 前端沿用上次存下的方向；上次若弹成独立窗口，新开时回到默认停靠，不自动弹窗
  import('./ui/legacy/legacy.js')
    .then((UI) => {
      const dock = UI.DockController.DockController.instance();
      if (dock.dockSide() === 'undocked') dock.setDockSide('bottom');
      emit({ side: dock.dockSide() });
      window.dispatchEvent(new Event('resize'));
    })
    .catch(() => {});
})()`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRect(raw: unknown): DevtoolsRect | null {
  if (!isRecord(raw)) return null;
  const keys = ['x', 'y', 'width', 'height'] as const;
  if (Object.keys(raw).length !== keys.length) return null;
  const out = {} as DevtoolsRect;
  for (const key of keys) {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_DIMENSION)
      return null;
    out[key] = Math.round(value);
  }
  return out;
}

export function parseDevtoolsDockMessage(message: string): DevtoolsDockMessage | null {
  if (!message.startsWith(DOCK_TAG)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(message.slice(DOCK_TAG.length));
  } catch {
    return null;
  }
  if (!isRecord(payload) || Object.keys(payload).length !== 1) return null;
  if ('closed' in payload) return payload.closed === true ? { closed: true } : null;
  if ('side' in payload) {
    const side = payload.side;
    return typeof side === 'string' && (SIDES as readonly string[]).includes(side)
      ? { side: side as DevtoolsDockSide }
      : null;
  }
  if ('bounds' in payload) {
    const bounds = parseRect(payload.bounds);
    return bounds ? { bounds } : null;
  }
  return null;
}

/**
 * 分区 Preferences 里存着上次的停靠方向；是 undocked 时前端会在注入脚本前就自行 undock，
 * Electron 随即另开空白窗口。打开前把它改回 bottom；无需改写时返回 null。
 */
export function resetUndockedDevtoolsPreference(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const electron = parsed.electron;
  const devtools = isRecord(electron) ? electron.devtools : undefined;
  const preferences = isRecord(devtools) ? devtools.preferences : undefined;
  if (!isRecord(preferences) || preferences.currentDockState !== '"undocked"') return null;
  preferences.currentDockState = '"bottom"';
  return JSON.stringify(parsed);
}

/** DevTools 铺满舞台时，网页按前端上报的区域叠在它上面；坐标从舞台局部换算成窗口坐标 */
export function devtoolsGuestBounds(stage: DevtoolsRect, page: DevtoolsRect): DevtoolsRect | null {
  const left = Math.max(stage.x, stage.x + page.x);
  const top = Math.max(stage.y, stage.y + page.y);
  const right = Math.min(stage.x + stage.width, stage.x + page.x + page.width);
  const bottom = Math.min(stage.y + stage.height, stage.y + page.y + page.height);
  if (right - left < 1 || bottom - top < 1) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
