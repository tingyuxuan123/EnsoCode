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
/**
 * 注意：不要把本守卫挂到承载插件 iframe 的主窗口上。实测 Electron 43 在沙箱子帧
 * 上被同步咨询导航时会让主进程原生自旋（即使回调只被调用两次、没有 preventDefault）。
 * 插件侧栏帧的边界现由 sandbox、壳页面 CSP 与一次性 nonce 约束；本函数保留给
 * 未来独立的插件专用窗口使用。
 */
export function installPluginViewNavigationGuard(contents: NavigationContents): void {
  const guard = (event: PluginNavigationEvent) => {
    if (event.isMainFrame) return;
    try {
      const frameUrls: string[] = [];
      const source = event.frame;
      const seen = new Set<NavigationFrame>();
      for (let frame = source; frame && frame !== contents.mainFrame; frame = frame.parent) {
        // Electron 每次返回新的祖先包装器，引用比较不可靠；有界遍历只用于收集 URL。
        // 无法确认祖先时按“非插件帧”放行，宁可少拦也不要把 Chromium 卡在重试里。
        if (seen.has(frame) || seen.size >= 32) break;
        seen.add(frame);
        frameUrls.push(frame.url);
      }
      if (
        shouldBlockPluginViewNavigation({
          mainUrl: contents.getURL(),
          url: event.url,
          isMainFrame: false,
          frameUrls,
          frameName: source?.name,
        })
      )
        event.preventDefault();
    } catch {
      // 卸载/重载后 WebFrameMain getter 会同步抛错；此时不能判定是插件帧，放行
      // 由 sandbox/CSP 继续约束，避免在原生导航重试里反复 preventDefault 卡死主进程。
    }
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
    // 沙箱 iframe 的初始空文档不是插件可控内容；拦截它会让 Chromium 反复重试并卡死 Main。
    if (input.url === 'about:blank') return false;
    return plugin && withoutHash(input.url) !== shell;
  } catch {
    return input.frameName === 'enso-plugin-view';
  }
}
