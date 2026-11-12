import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveWindowsAppUserModelId,
  shouldSetWindowIcon,
  WINDOWS_APP_USER_MODEL_ID,
  windowIconCandidates,
  windowsTaskbarAppDetails,
} from './windowIcon';

describe('shouldSetWindowIcon', () => {
  it('skips packaged Windows so Shell uses EXE RT_GROUP_ICON (EnsoAI parity)', () => {
    expect(shouldSetWindowIcon({ platform: 'win32', isPackaged: true })).toBe(false);
  });

  it('sets icon in Windows dev (host exe is electron.exe)', () => {
    expect(shouldSetWindowIcon({ platform: 'win32', isPackaged: false })).toBe(true);
  });

  it('never sets icon on macOS (dock / icns path)', () => {
    expect(shouldSetWindowIcon({ platform: 'darwin', isPackaged: true })).toBe(false);
    expect(shouldSetWindowIcon({ platform: 'darwin', isPackaged: false })).toBe(false);
  });

  it('sets icon on Linux packaged and dev', () => {
    expect(shouldSetWindowIcon({ platform: 'linux', isPackaged: true })).toBe(true);
    expect(shouldSetWindowIcon({ platform: 'linux', isPackaged: false })).toBe(true);
  });
});

describe('resolveWindowsAppUserModelId', () => {
  it('uses .dev for unpackaged electron.exe hosts', () => {
    expect(
      resolveWindowsAppUserModelId({
        execPath: String.raw`C:\nvm4w\nodejs\electron.exe`,
        isPackaged: false,
      })
    ).toBe(`${WINDOWS_APP_USER_MODEL_ID}.dev`);
  });

  it('uses .portable for win-unpacked so taskbar ignores installed shortcut icon', () => {
    expect(
      resolveWindowsAppUserModelId({
        execPath: String.raw`D:\projects\EnsoCode\dist\win-unpacked\EnsoCode.exe`,
        isPackaged: true,
      })
    ).toBe(`${WINDOWS_APP_USER_MODEL_ID}.portable`);
  });

  it('keeps stable AUMID for installed Program Files builds', () => {
    expect(
      resolveWindowsAppUserModelId({
        execPath: String.raw`C:\Users\J3n5en\AppData\Local\Programs\enso-code\EnsoCode.exe`,
        isPackaged: true,
      })
    ).toBe(WINDOWS_APP_USER_MODEL_ID);
  });
});

describe('windowsTaskbarAppDetails', () => {
  it('pins RelaunchIcon to the running exe under the given AUMID', () => {
    const details = windowsTaskbarAppDetails({
      execPath: String.raw`D:\projects\EnsoCode\dist\win-unpacked\EnsoCode.exe`,
      appId: `${WINDOWS_APP_USER_MODEL_ID}.portable`,
    });
    expect(details.appId).toBe(`${WINDOWS_APP_USER_MODEL_ID}.portable`);
    expect(details.appIconPath).toBe(
      String.raw`D:\projects\EnsoCode\dist\win-unpacked\EnsoCode.exe`
    );
    expect(details.appIconIndex).toBe(0);
    expect(details.relaunchCommand).toContain('EnsoCode.exe');
    expect(details.relaunchDisplayName).toBe('Collabra');
  });

  it('quotes relaunchCommand when the path has spaces', () => {
    const details = windowsTaskbarAppDetails({
      execPath: String.raw`C:\Program Files\EnsoCode\EnsoCode.exe`,
      appId: WINDOWS_APP_USER_MODEL_ID,
    });
    expect(details.relaunchCommand).toBe('"C:\\Program Files\\EnsoCode\\EnsoCode.exe"');
  });
});

describe('windowIconCandidates', () => {
  it('prefers multi-size icon.ico on Windows (taskbar AND-mask frames)', () => {
    const candidates = windowIconCandidates({
      resourcesPath: '/Resources',
      appPath: '/app.asar',
      cwd: '/repo',
      platform: 'win32',
    });
    expect(candidates[0]).toBe(join('/Resources', 'icon.ico'));
    expect(candidates).toContain(join('/repo', 'build', 'icon.ico'));
    expect(candidates).toContain(join('/app.asar', 'build', 'icon.ico'));
  });

  it('prefers icon-win.png on Linux', () => {
    const candidates = windowIconCandidates({
      resourcesPath: '/Resources',
      appPath: '/app.asar',
      cwd: '/repo',
      platform: 'linux',
    });
    expect(candidates[0]).toBe(join('/Resources', 'icon-win.png'));
  });
});
