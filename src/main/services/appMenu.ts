import { app, Menu, type MenuItemConstructorOptions } from 'electron';

export const APP_DISPLAY_NAME = '小满';

/**
 * Electron 默认 appMenu 用 app.name（package.json name = enso-code）拼 About/Hide/Quit。
 * 不能改 app.name：macOS safeStorage 钥匙串条目按 app.name 命名，改了会解不开已存凭据。
 */
export function macAppMenuTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: APP_DISPLAY_NAME,
      submenu: [
        { role: 'about', label: `About ${APP_DISPLAY_NAME}` },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: `Hide ${APP_DISPLAY_NAME}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${APP_DISPLAY_NAME}` },
      ],
    },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
}

export function installAppMenu(): void {
  app.setAboutPanelOptions({ applicationName: APP_DISPLAY_NAME });
  if (process.platform !== 'darwin') return;
  Menu.setApplicationMenu(Menu.buildFromTemplate(macAppMenuTemplate()));
}
