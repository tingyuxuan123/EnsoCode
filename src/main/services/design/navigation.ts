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
    const registered = ports();
    let origin: string | undefined;
    let plugin = false;
    // Plugin views retain their existing independent navigation policy, including descendants.
    const pluginUrl = new URL('plugin-view.html', contents.getURL()).href;
    for (let frame = event.frame; frame && frame !== contents.mainFrame; frame = frame.parent) {
      if (frame.name === 'enso-plugin-view' || frame.url.split('#')[0] === pluginUrl) plugin = true;
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
    else if (event.frame) {
      const next = engineOrigin(event.url, registered);
      if (next) bound.set(event.frame, next);
    }
  };
  contents.on('will-frame-navigate', guard);
  contents.on('will-redirect', guard);
}
