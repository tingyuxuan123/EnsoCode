import { describe, expect, it } from 'vitest';
import { windowChromeOptions } from './windowChrome';

describe('windowChromeOptions', () => {
  it('keeps the Windows host opaque and exposes native caption buttons for a pinned workbench', () => {
    expect(windowChromeOptions('win32', true, false)).toMatchObject({
      frame: false,
      titleBarStyle: 'hidden',
      thickFrame: true,
      transparent: false,
      backgroundColor: '#ffffff',
      titleBarOverlay: { color: '#00000000', symbolColor: '#111111', height: 44 },
    });
  });

  it('uses a dark initial surface for native controls and normal Windows windows', () => {
    expect(windowChromeOptions('win32', false, true)).toMatchObject({
      backgroundColor: '#202020',
      titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 44 },
    });
  });

  it.each(['darwin', 'linux'])('preserves transparent pinned workbenches on %s', (platform) => {
    const options = windowChromeOptions(platform, true, false);
    expect(options.transparent).toBe(true);
    expect(options.backgroundColor).toBe('#00000000');
    expect(options.titleBarOverlay).toBeUndefined();
    expect(options.frame).toBe(platform === 'darwin');
  });

  it('keeps Linux controls in the renderer', () => {
    expect(windowChromeOptions('linux', false, false)).toEqual({
      frame: false,
      titleBarStyle: 'hidden',
    });
  });
});
