import { join } from 'node:path';

/**
 * Windows taskbar/Shell wants a multi-size .ico (BMP frames ≤128 with AND mask).
 * A single PNG (icon-win.png) downscales to a square plate on the taskbar.
 * Linux still prefers a PNG path.
 */
export const WINDOW_ICON_FILE_WIN = 'icon.ico';
export const WINDOW_ICON_FILE_LINUX = 'icon-win.png';

/** Must match electron-builder.yml `appId` for installed builds. */
export const WINDOWS_APP_USER_MODEL_ID = 'com.j3n5en.enso-code';

/**
 * Packaged Windows must NOT BrowserWindow.setIcon.
 *
 * Electron nativeImage loads only the largest ICO frame and builds one HICON;
 * the taskbar then paints a square plate. EnsoAI never setIcon when packaged —
 * Shell reads the EXE RT_GROUP_ICON (multi-size BMP + AND mask) instead.
 * Dev still needs setIcon because the host exe is electron.exe.
 */
export function shouldSetWindowIcon(input: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
}): boolean {
  if (input.platform === 'darwin') return false;
  if (input.platform === 'win32' && input.isPackaged) return false;
  return true;
}

/**
 * win-unpacked / portable runs must not share the installed Start Menu AUMID.
 *
 * Windows taskbar icon for a given AppUserModelId comes from the registered
 * shortcut, not the running exe. setAppDetails(appIconPath) does not override
 * that. A distinct AUMID lets Shell use this process's own RT_GROUP_ICON.
 */
export function resolveWindowsAppUserModelId(input: {
  execPath: string;
  isPackaged: boolean;
}): string {
  if (!input.isPackaged) return `${WINDOWS_APP_USER_MODEL_ID}.dev`;
  const normalized = input.execPath.replace(/\//g, '\\').toLowerCase();
  // electron-builder dir output, or any copy outside Local\Programs\enso-code
  if (normalized.includes('\\win-unpacked\\') || normalized.includes('\\dist\\')) {
    return `${WINDOWS_APP_USER_MODEL_ID}.portable`;
  }
  return WINDOWS_APP_USER_MODEL_ID;
}

/**
 * Pin taskbar relaunch metadata to the running exe (Jump List / some shells).
 * AUMID itself is chosen by resolveWindowsAppUserModelId — that is what fixes
 * the installed-shortcut square plate when testing win-unpacked.
 */
export function windowsTaskbarAppDetails(input: {
  execPath: string;
  appId: string;
  displayName?: string;
}): {
  appId: string;
  appIconPath: string;
  appIconIndex: number;
  relaunchCommand: string;
  relaunchDisplayName: string;
} {
  const exe = input.execPath;
  const quoted = exe.includes(' ') ? `"${exe}"` : exe;
  return {
    appId: input.appId,
    appIconPath: exe,
    appIconIndex: 0,
    relaunchCommand: quoted,
    relaunchDisplayName: input.displayName ?? 'Eaves',
  };
}

/** Packaged extraResources first, then repo build/ for `electron-vite dev`. */
export function windowIconCandidates(input: {
  resourcesPath: string;
  appPath: string;
  cwd: string;
  platform?: NodeJS.Platform;
}): string[] {
  const file =
    (input.platform ?? process.platform) === 'linux'
      ? WINDOW_ICON_FILE_LINUX
      : WINDOW_ICON_FILE_WIN;
  return [
    join(input.resourcesPath, file),
    join(input.cwd, 'build', file),
    join(input.appPath, 'build', file),
  ];
}
