interface NavigationFrame {
  url: string;
  name: string;
  parent: NavigationFrame | null;
}
export interface DesignNavigationEvent {
  isMainFrame: boolean;
  frame: NavigationFrame | null;
  url: string;
  preventDefault(): void;
}
interface NavigationContents {
  mainFrame: NavigationFrame;
  getURL(): string;
  on(
    name: 'will-frame-navigate' | 'will-redirect',
    listener: (event: DesignNavigationEvent) => void
  ): unknown;
  off?(
    name: 'will-frame-navigate' | 'will-redirect',
    listener: (event: DesignNavigationEvent) => void
  ): unknown;
  once?(event: 'destroyed', listener: () => void): unknown;
}
function engineOrigin(url: string, ports: ReadonlySet<number>): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' &&
      parsed.hostname === '127.0.0.1' &&
      !parsed.username &&
      !parsed.password &&
      ports.has(Number(parsed.port))
      ? parsed.origin
      : undefined;
  } catch {
    return undefined;
  }
}
/** The parent workbench is trusted. Guard content-initiated navigation, not the parent's
 * synchronous about:blank reset (Chromium does not emit will-frame-navigate for that).
 * about:blank is safe to allow: self-navigation inherits the initiator's origin and has no code.
 * CSP also blocks data:/non-loopback loads before these events; a failed document's URL
 * may still be reported by WebFrameMain even though no target code ran. */
export function shouldBlockDesignNavigation(input: {
  isMainFrame: boolean;
  url: string;
  ports: ReadonlySet<number>;
  origin?: string;
}): boolean {
  if (input.isMainFrame) return false;
  if (input.url === 'about:blank') return false;
  const origin = engineOrigin(input.url, input.ports);
  return !origin || (!!input.origin && origin !== input.origin);
}
export function installDesignNavigationGuard(
  contents: NavigationContents,
  ports: () => ReadonlySet<number>
): void {
  const bound = new WeakMap<NavigationFrame, string>();
  const guard = (event: DesignNavigationEvent) => {
    if (event.isMainFrame) return;
    try {
      const registered = ports();
      let origin: string | undefined;
      let plugin = false;
      // Plugin views retain their existing independent navigation policy, including descendants.
      const pluginUrl = new URL('plugin-view.html', contents.getURL()).href;
      const source = event.frame;
      const seen = new Set<NavigationFrame>();
      for (let frame = source; frame && frame !== contents.mainFrame; frame = frame.parent) {
        // Electron 每次返回新的祖先包装器，引用比较不可靠；有界遍历只用于收集来源，
        // 触顶时用已收集到的信息判定，绝不能在原生导航里反复 preventDefault。
        if (seen.has(frame) || seen.size >= 32) break;
        seen.add(frame);
        if (frame.name === 'enso-plugin-view' || frame.url.split('#')[0] === pluginUrl)
          plugin = true;
        origin ??= bound.get(frame) ?? engineOrigin(frame.url, registered);
      }
      if (!origin && plugin) return;
      if (
        shouldBlockDesignNavigation({
          isMainFrame: false,
          url: event.url,
          ports: registered,
          origin,
        })
      )
        event.preventDefault();
      else if (source) {
        const next = engineOrigin(event.url, registered);
        if (next) bound.set(source, next);
      }
    } catch {
      // 插件/设计 iframe 拆卸后 WebFrameMain 属性可能抛错；不能让错误冒泡到 Main，
      // 也不在这里 preventDefault：反复阻止原生导航会让 Electron 陷入重试自旋。
    }
  };
  // 只有存在设计引擎帧时才挂监听：Electron 43 在沙箱子帧上被同步咨询导航时会
  // 让主进程原生自旋（插件侧栏帧已实测），空闲窗口不应承担这个风险。
  let attached = false;
  const sync = () => {
    const active = ports().size > 0;
    if (active === attached) return;
    attached = active;
    if (active) {
      contents.on('will-frame-navigate', guard);
      contents.on('will-redirect', guard);
    } else {
      contents.off?.('will-frame-navigate', guard);
      contents.off?.('will-redirect', guard);
    }
  };
  sync();
  const timer = setInterval(sync, 1000);
  timer.unref?.();
  contents.once?.('destroyed', () => {
    clearInterval(timer);
    if (attached) {
      contents.off?.('will-frame-navigate', guard);
      contents.off?.('will-redirect', guard);
    }
  });
}
