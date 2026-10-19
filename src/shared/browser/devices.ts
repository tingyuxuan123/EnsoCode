import type { BrowserDevice } from '../types/browser';

export type BrowserDeviceCategory = 'phone' | 'foldable' | 'tablet' | 'desktop';

export const BROWSER_DEVICE_CATEGORIES: readonly { id: BrowserDeviceCategory; name: string }[] = [
  { id: 'phone', name: 'Phones' },
  { id: 'foldable', name: 'Foldable phones' },
  { id: 'tablet', name: 'Tablets' },
  { id: 'desktop', name: 'Desktop' },
];

const phone = { category: 'phone', mobile: true, touch: true } as const;
const foldable = { category: 'foldable', mobile: true, touch: true } as const;
const tablet = { category: 'tablet', mobile: true, touch: true } as const;
const desktop = { category: 'desktop', deviceScaleFactor: 1, mobile: false, touch: false } as const;

export const BROWSER_DEVICE_PROFILES = [
  { id: 'iphone-se', name: 'iPhone SE', width: 375, height: 667, deviceScaleFactor: 2, ...phone },
  {
    id: 'iphone-12-pro',
    name: 'iPhone 12 Pro',
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    ...phone,
  },
  {
    id: 'iphone-14-pro',
    name: 'iPhone 14 Pro / 16',
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    ...phone,
  },
  {
    id: 'iphone-14-pro-max',
    name: 'iPhone 14 Pro Max',
    width: 430,
    height: 932,
    deviceScaleFactor: 3,
    ...phone,
  },
  {
    id: 'iphone-16-pro',
    name: 'iPhone 16 Pro / 17 / 17 Pro',
    width: 402,
    height: 874,
    deviceScaleFactor: 3,
    ...phone,
  },
  {
    id: 'iphone-16-pro-max',
    name: 'iPhone 16 Pro Max / 17 Pro Max',
    width: 440,
    height: 956,
    deviceScaleFactor: 3,
    ...phone,
  },
  { id: 'pixel-7', name: 'Pixel 7', width: 412, height: 915, deviceScaleFactor: 2.625, ...phone },
  { id: 'pixel-8', name: 'Pixel 8', width: 412, height: 915, deviceScaleFactor: 2.625, ...phone },
  { id: 'pixel-9', name: 'Pixel 9', width: 412, height: 924, deviceScaleFactor: 2.625, ...phone },
  {
    id: 'galaxy-s20-ultra',
    name: 'Samsung Galaxy S20 Ultra',
    width: 412,
    height: 915,
    deviceScaleFactor: 3.5,
    ...phone,
  },
  {
    id: 'iphone-duo-outer',
    name: 'iPhone Duo outer',
    width: 466,
    height: 678,
    deviceScaleFactor: 3,
    ...foldable,
  },
  {
    id: 'iphone-duo-inner',
    name: 'iPhone Duo inner',
    width: 669,
    height: 951,
    deviceScaleFactor: 3,
    ...foldable,
  },
  { id: 'ipad-mini', name: 'iPad Mini', width: 768, height: 1024, deviceScaleFactor: 2, ...tablet },
  {
    id: 'ipad-pro-13',
    name: 'iPad Pro 13',
    width: 1032,
    height: 1376,
    deviceScaleFactor: 2,
    ...tablet,
  },
  { id: 'desktop-1280', name: 'Desktop 1280 × 800', width: 1280, height: 800, ...desktop },
  { id: 'desktop-1440', name: 'Desktop 1440 × 900', width: 1440, height: 900, ...desktop },
  { id: 'desktop-1920', name: 'Desktop 1920 × 1080', width: 1920, height: 1080, ...desktop },
] as const;

export function parseBrowserDevice(raw: unknown): BrowserDevice {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('device must be an object');
  const record = raw as Record<string, unknown>;
  const keys = new Set([
    'enabled',
    'profileId',
    'width',
    'height',
    'deviceScaleFactor',
    'mobile',
    'touch',
    'orientation',
    'scale',
  ]);
  if (!Object.keys(record).every((key) => keys.has(key))) throw new Error('Unknown device field');
  if (typeof record.enabled !== 'boolean') throw new Error('device.enabled must be boolean');
  if (!record.enabled) return { enabled: false };
  const profile =
    record.profileId === undefined || record.profileId === 'responsive'
      ? undefined
      : BROWSER_DEVICE_PROFILES.find((entry) => entry.id === record.profileId);
  if (record.profileId !== undefined && record.profileId !== 'responsive' && !profile)
    throw new Error('Unknown device profileId');
  const number = (key: string, fallback: number | undefined, min: number, max: number): number => {
    const value = record[key] ?? fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      throw new Error(`Invalid device.${key}`);
    return value;
  };
  const boolean = (key: string, fallback: boolean): boolean => {
    const value = record[key] ?? fallback;
    if (typeof value !== 'boolean') throw new Error(`Invalid device.${key}`);
    return value;
  };
  const orientation = record.orientation ?? 'portrait';
  if (orientation !== 'portrait' && orientation !== 'landscape')
    throw new Error('Invalid device.orientation');
  let width = Math.round(number('width', profile?.width, 50, 8192));
  let height = Math.round(number('height', profile?.height, 50, 8192));
  if (
    record.orientation !== undefined &&
    (orientation === 'landscape' ? width < height : width > height)
  )
    [width, height] = [height, width];
  if (width * height > 20_000_000) throw new Error('Device viewport exceeds pixel budget');
  return {
    enabled: true,
    ...(typeof record.profileId === 'string' ? { profileId: record.profileId } : {}),
    width,
    height,
    deviceScaleFactor: number('deviceScaleFactor', profile?.deviceScaleFactor ?? 1, 0.5, 4),
    mobile: boolean('mobile', profile?.mobile ?? false),
    touch: boolean('touch', profile?.touch ?? false),
    orientation,
    ...(record.scale !== undefined ? { scale: number('scale', undefined, 0.05, 1) } : {}),
  };
}
