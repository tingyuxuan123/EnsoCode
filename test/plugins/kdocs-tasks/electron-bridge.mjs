// Vite SSR cannot discover Electron's runtime-only CommonJS named exports.
// The hidden Electron smoke runner supplies this object; never used by production.
const electron = globalThis[Symbol.for('collabra.kdocs.electron-fixture')];
if (!electron) throw new Error('Electron fixture bridge must run inside its smoke harness');
export const {
  app,
  BrowserWindow,
  WebContentsView,
  session,
  protocol,
  Menu,
  screen,
  ipcMain,
  clipboard,
  shell,
  nativeImage,
  Notification,
  utilityProcess,
  webContents,
  dialog,
  net,
  safeStorage,
  systemPreferences,
} = electron;
export default electron;
