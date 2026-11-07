import { app } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { APP_DISPLAY_NAME, installAppMenu, macAppMenuTemplate } from './appMenu';

vi.mock('electron', () => ({
  app: { setAboutPanelOptions: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
}));

describe('macAppMenuTemplate', () => {
  it('sets the About panel display name without renaming the app identity', () => {
    installAppMenu();
    expect(app.setAboutPanelOptions).toHaveBeenCalledWith({ applicationName: 'Eaves' });
  });

  it('labels app menu items with the product name instead of the package name', () => {
    const [appMenu] = macAppMenuTemplate();
    expect(appMenu.label).toBe(APP_DISPLAY_NAME);
    const items = appMenu.submenu as { role?: string; label?: string }[];
    const labelOf = (role: string) => items.find((item) => item.role === role)?.label;
    expect(labelOf('about')).toBe('About Eaves');
    expect(labelOf('hide')).toBe('Hide Eaves');
    expect(labelOf('quit')).toBe('Quit Eaves');
    expect(JSON.stringify(macAppMenuTemplate())).not.toContain('enso-code');
  });

  it('keeps the remaining default top-level menus', () => {
    expect(macAppMenuTemplate().slice(1)).toEqual([
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]);
  });
});
