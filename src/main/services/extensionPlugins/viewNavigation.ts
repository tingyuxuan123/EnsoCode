interface PluginViewNavigation {
  mainUrl: string;
  url: string;
  isMainFrame: boolean;
  frameUrls: readonly string[];
  frameName?: string;
}

interface NavigationFrame {
  url: string;
  name: string;
  parent: NavigationFrame | null;
}
export interface PluginNavigationEvent {
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
    listener: (event: PluginNavigationEvent) => void
  ): unknown;
}
export function installPluginViewNavigationGuard(contents: NavigationContents): void {
  const guard = (event: PluginNavigationEvent) => {
    if (event.isMainFrame) return;
    const frameUrls: string[] = [];
    for (let frame = event.frame; frame && frame !== contents.mainFrame; frame = frame.parent)
      frameUrls.push(frame.url);
    if (
      shouldBlockPluginViewNavigation({
        mainUrl: contents.getURL(),
        url: event.url,
        isMainFrame: event.isMainFrame,
        frameUrls,
        frameName: event.frame?.name,
      })
    )
      event.preventDefault();
  };
  contents.on('will-frame-navigate', guard);
  contents.on('will-redirect', guard);
}

/** Compare the trusted shell URL, not a pathname on a potentially remote origin. */
export function shouldBlockPluginViewNavigation(input: PluginViewNavigation): boolean {
  if (input.isMainFrame) return false;
  try {
    const shell = new URL('plugin-view.html', input.mainUrl).href;
    const withoutHash = (value: string) => {
      try {
        const url = new URL(value);
        url.hash = '';
        return url.href;
      } catch {
        return null;
      }
    };
    const plugin =
      input.frameName === 'enso-plugin-view' ||
      input.frameUrls.some((url) => withoutHash(url) === shell);
    return plugin && withoutHash(input.url) !== shell;
  } catch {
    return input.frameName === 'enso-plugin-view';
  }
}
