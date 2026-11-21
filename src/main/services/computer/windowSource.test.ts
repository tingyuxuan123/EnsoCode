import { afterEach, describe, expect, it } from 'vitest';
import {
  COMPUTER_OCCUPANCY_WINDOW_TITLE,
  COMPUTER_PREVIEW_WINDOW_TITLE,
  findCapturerWindowSource,
  isComputerInternalWindow,
  isListedCgWindowLayer,
  parseMediaSourceWindowId,
  registerComputerInternalWindowId,
  thumbnailCropForWindow,
  trackComputerInternalWindow,
  unregisterComputerInternalWindowId,
} from './windowSource';

describe('isListedCgWindowLayer', () => {
  it('普通窗和 modal sheet 列出，菜单栏不列', () => {
    expect(isListedCgWindowLayer(0)).toBe(true);
    expect(isListedCgWindowLayer(3)).toBe(true);
    expect(isListedCgWindowLayer(8)).toBe(true);
    expect(isListedCgWindowLayer(25)).toBe(false);
  });
});

describe('findCapturerWindowSource', () => {
  it('CG 窗口号能对上 Electron source id', () => {
    const sources = [{ id: 'window:88:0' }, { id: 'window:17519:0' }];
    expect(findCapturerWindowSource(sources, '17519')?.id).toBe('window:17519:0');
    expect(findCapturerWindowSource(sources, '9')).toBeUndefined();
  });
});

describe('thumbnailCropForWindow', () => {
  it('把窗口矩形映到桌面缩略图像素', () => {
    expect(
      thumbnailCropForWindow({
        window: { x: 100, y: 50, width: 200, height: 80 },
        display: { x: 0, y: 0, width: 1000, height: 500 },
        thumbnailWidth: 100,
        thumbnailHeight: 50,
      })
    ).toEqual({ x: 10, y: 5, width: 20, height: 8 });
  });
});

describe('computer internal window filtering', () => {
  afterEach(() => {
    unregisterComputerInternalWindowId('1590');
    unregisterComputerInternalWindowId('1600');
  });

  it('parseMediaSourceWindowId 从 Electron mediaSourceId 提取窗口 ID', () => {
    expect(parseMediaSourceWindowId('window:1590:0')).toBe('1590');
    expect(parseMediaSourceWindowId('screen:1:0')).toBeUndefined();
    expect(parseMediaSourceWindowId('')).toBeUndefined();
    expect(parseMediaSourceWindowId(undefined)).toBeUndefined();
  });

  it('isComputerInternalWindow 过滤预览窗与占用横幅专属标题及已注册窗口 ID', () => {
    expect(isComputerInternalWindow({ id: '1541', title: 'CodeKiln' })).toBe(false);
    expect(isComputerInternalWindow({ id: '1590', title: COMPUTER_PREVIEW_WINDOW_TITLE })).toBe(
      true
    );
    expect(isComputerInternalWindow({ id: '1591', title: COMPUTER_OCCUPANCY_WINDOW_TITLE })).toBe(
      true
    );

    registerComputerInternalWindowId('1590');
    expect(isComputerInternalWindow({ id: '1590', title: 'CodeKiln' })).toBe(true);
    expect(isComputerInternalWindow({ id: 'window:1590:0', title: 'CodeKiln' })).toBe(true);
    expect(isComputerInternalWindow({ id: '1541', title: 'CodeKiln' })).toBe(false);

    unregisterComputerInternalWindowId('1590');
    expect(isComputerInternalWindow({ id: '1590', title: 'CodeKiln' })).toBe(false);
  });

  it('trackComputerInternalWindow 在关闭后自动注销窗口 ID', () => {
    const handlers = new Map<string, () => void>();
    trackComputerInternalWindow({
      getMediaSourceId: () => 'window:1600:0',
      once: (event, listener) => {
        handlers.set(event, listener);
      },
    });
    expect(isComputerInternalWindow({ id: '1600', title: '' })).toBe(true);
    handlers.get('closed')?.();
    expect(isComputerInternalWindow({ id: '1600', title: '' })).toBe(false);
  });
});
