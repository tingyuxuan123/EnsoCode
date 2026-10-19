import { describe, expect, it } from 'vitest';
import { BROWSER_DEVICE_CATEGORIES, BROWSER_DEVICE_PROFILES, parseBrowserDevice } from './devices';
import { effectiveBrowserViewport } from './viewport';

describe('浏览器设备配置', () => {
  it('预设包含桌面、手机和平板，方向归一后保持 DPR 和触摸身份', () => {
    expect(BROWSER_DEVICE_PROFILES.some((p) => !p.mobile)).toBe(true);
    const phone = BROWSER_DEVICE_PROFILES.find((p) => p.id === 'iphone-14-pro');
    expect(phone).toBeDefined();
    const device = parseBrowserDevice({
      enabled: true,
      profileId: phone?.id,
      orientation: 'landscape',
    });
    expect(device).toMatchObject({
      width: 852,
      height: 393,
      deviceScaleFactor: 3,
      mobile: true,
      touch: true,
    });
  });

  it('预设按手机 / 折叠屏 / 平板 / 桌面分组，id 唯一且保留旧 id', () => {
    const ids = BROWSER_DEVICE_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      'desktop-1280',
      'iphone-se',
      'iphone-14-pro',
      'pixel-9',
      'ipad-mini',
      'ipad-pro-13',
    ])
      expect(ids).toContain(id);
    expect(BROWSER_DEVICE_CATEGORIES.map((c) => c.id)).toEqual([
      'phone',
      'foldable',
      'tablet',
      'desktop',
    ]);
    for (const category of BROWSER_DEVICE_CATEGORIES)
      expect(BROWSER_DEVICE_PROFILES.some((p) => p.category === category.id)).toBe(true);
    expect(BROWSER_DEVICE_PROFILES.find((p) => p.id === 'iphone-16-pro-max')).toMatchObject({
      width: 440,
      height: 956,
      deviceScaleFactor: 3,
    });
    expect(BROWSER_DEVICE_PROFILES.find((p) => p.id === 'galaxy-s20-ultra')).toMatchObject({
      width: 412,
      height: 915,
      deviceScaleFactor: 3.5,
    });
    expect(
      BROWSER_DEVICE_PROFILES.filter((p) => p.category === 'desktop').every(
        (p) => !p.mobile && !p.touch
      )
    ).toBe(true);
  });

  it('自定义尺寸完整校验，关闭时不保留旧 override', () => {
    expect(parseBrowserDevice({ enabled: false })).toEqual({ enabled: false });
    expect(parseBrowserDevice({ enabled: true, width: 600, height: 900 })).toMatchObject({
      width: 600,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
      touch: false,
    });
    for (const raw of [
      null,
      {},
      { enabled: true },
      { enabled: true, profileId: 'missing' },
      { enabled: true, width: Infinity, height: 5 },
      { enabled: true, width: 500, height: 500, scale: 0 },
      { enabled: true, width: 500, height: 500, touch: 'yes' },
    ]) {
      expect(() => parseBrowserDevice(raw)).toThrow();
    }
  });

  it('面板缩放和隐藏不改变设备逻辑 viewport', () => {
    const device = parseBrowserDevice({ enabled: true, profileId: 'iphone-14-pro' });
    const shown = effectiveBrowserViewport(device, { x: 10, y: 10, width: 300, height: 400 });
    const hidden = effectiveBrowserViewport(device, null);
    expect(shown).toMatchObject({ width: 393, height: 852, deviceScaleFactor: 3 });
    expect(hidden).toMatchObject({ width: 393, height: 852, deviceScaleFactor: 3 });
    expect(shown.scale).toBeCloseTo(400 / 852);
    expect(effectiveBrowserViewport({ enabled: false }, null)).toMatchObject({
      width: 1280,
      height: 800,
    });
  });
});
