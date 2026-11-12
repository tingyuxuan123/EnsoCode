import {
  WINDOW_TITLE_BAR_HEIGHT,
  WINDOWS_CAPTION_BACKGROUND,
  WINDOWS_SYMBOL_COLOR,
} from '@shared/windowControls';
import type { BrowserWindowConstructorOptions } from 'electron';

/**
 * Windows 顶层窗口保持不透明，保留系统缩放和贴靠；工作区视图自身仍可透明。
 * macOS 和 Linux 保留原有标题栏与透明窗口约定。
 *
 * Keep the Windows host opaque for native resizing and snapping while allowing
 * transparent workbench views. Preserve existing macOS and Linux window chrome.
 */
export function windowChromeOptions(
  platform: string,
  pinnedWorkbench: boolean,
  dark: boolean
): BrowserWindowConstructorOptions {
  if (platform === 'win32') {
    const color = dark ? '#202020' : '#ffffff';
    return {
      frame: false,
      titleBarStyle: 'hidden',
      thickFrame: true,
      transparent: false,
      backgroundColor: color,
      titleBarOverlay: {
        color: WINDOWS_CAPTION_BACKGROUND,
        symbolColor: dark ? WINDOWS_SYMBOL_COLOR.onDark : WINDOWS_SYMBOL_COLOR.onLight,
        height: WINDOW_TITLE_BAR_HEIGHT,
      },
    };
  }
  return {
    frame: platform === 'darwin',
    titleBarStyle: platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(pinnedWorkbench ? { transparent: true, backgroundColor: '#00000000' } : {}),
  };
}
