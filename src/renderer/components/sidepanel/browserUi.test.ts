import { describe, expect, it } from 'vitest';
import {
  browserDeviceFrame,
  browserDownloadProgress,
  deviceStageClip,
  formatBrowserBytes,
  resolveBrowserAddress,
} from './browserUi';

describe('browserDeviceFrame', () => {
  const phone = { enabled: true, width: 393, height: 852 };
  it('fits the device inside the padded stage without upscaling', () => {
    const frame = browserDeviceFrame(phone, { width: 800, height: 760 }, 24);
    expect(frame?.scale).toBeCloseTo(712 / 852);
    expect(frame?.height).toBeLessThanOrEqual(712);
    expect(frame?.width).toBe(Math.floor(393 * (712 / 852)));
    expect(browserDeviceFrame(phone, { width: 2000, height: 2000 }, 24)).toEqual({
      width: 393,
      height: 852,
      scale: 1,
    });
  });
  it('keeps an explicit smaller scale but never exceeds the fit', () => {
    expect(browserDeviceFrame({ ...phone, scale: 0.5 }, { width: 2000, height: 2000 }, 0)).toEqual({
      width: 196,
      height: 426,
      scale: 0.5,
    });
    expect(
      browserDeviceFrame({ ...phone, scale: 1 }, { width: 400, height: 426 }, 0)?.scale
    ).toBeCloseTo(0.5);
  });
  it('returns null when emulation is off or the stage is unusable', () => {
    expect(browserDeviceFrame({ enabled: false }, { width: 800, height: 800 }, 0)).toBeNull();
    expect(browserDeviceFrame(undefined, { width: 800, height: 800 }, 0)).toBeNull();
    expect(browserDeviceFrame(phone, { width: 10, height: 10 }, 24)).toBeNull();
  });
});

describe('deviceStageClip', () => {
  it('punches the centered device frame out of the stage backdrop', () => {
    expect(deviceStageClip({ width: 500, height: 500 }, { width: 208, height: 452 })).toContain(
      '146px 24px, 354px 24px, 354px 476px, 146px 476px'
    );
    expect(deviceStageClip({ width: 500, height: 500 }, { width: 208, height: 452 })).toContain(
      'polygon(evenodd'
    );
  });
  it('leaves the backdrop whole without a frame or a usable stage', () => {
    expect(deviceStageClip({ width: 500, height: 500 }, null)).toBeUndefined();
    expect(deviceStageClip({ width: 0, height: 500 }, { width: 10, height: 10 })).toBeUndefined();
  });
});

describe('resolveBrowserAddress', () => {
  it('normalizes explicit URLs and bare domains', () => {
    expect(resolveBrowserAddress(' https://example.com/a?q=1 ')).toEqual({
      ok: true,
      result: 'https://example.com/a?q=1',
    });
    expect(resolveBrowserAddress('example.com/docs')).toEqual({
      ok: true,
      result: 'https://example.com/docs',
    });
    expect(resolveBrowserAddress('localhost:3000/test')).toEqual({
      ok: true,
      result: 'http://localhost:3000/test',
    });
    expect(resolveBrowserAddress('[::1]:8080')).toEqual({ ok: true, result: 'http://[::1]:8080/' });
  });

  it('encodes search terms instead of treating them as hosts', () => {
    expect(resolveBrowserAddress('布局 测试 & mobile')).toEqual({
      ok: true,
      result:
        'https://www.google.com/search?q=%E5%B8%83%E5%B1%80%20%E6%B5%8B%E8%AF%95%20%26%20mobile',
    });
    expect(resolveBrowserAddress('enso')).toEqual({
      ok: true,
      result: 'https://www.google.com/search?q=enso',
    });
  });

  it('preserves file URLs for Main workspace and realpath validation without trusting their paths', () => {
    for (const input of [
      'file:///workspace/index.html',
      'file:///workspace/a%20b.html?preview=1#section',
      'file:///workspace/../outside.html',
      'file:///outside/index.html',
      'file://server/share/index.html',
      ' FILE:///workspace/a/../index.html ',
    ])
      expect(resolveBrowserAddress(input)).toEqual({ ok: true, result: input });
  });

  it('rejects malformed or credential-bearing file URLs and NUL before invoking Main', () => {
    for (const input of [
      'file://[invalid/index.html',
      'file://user:password@localhost/index.html',
      'file:///workspace/a\0.html',
      'file:///workspace/a%00.html',
    ])
      expect(resolveBrowserAddress(input).ok, input).toBe(false);
  });

  it('rejects unsafe, malformed and credential-bearing addresses', () => {
    for (const input of [
      '',
      'javascript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html,test',
      'blob:https://example.com/a',
      'about:blank',
      'https://',
      'https://user:secret@example.com',
      'https://exa mple.com',
      'custom:payload',
      '//example.com',
    ]) {
      expect(resolveBrowserAddress(input).ok, input).toBe(false);
    }
  });
});

describe('download display', () => {
  it('formats byte counts without exposing NaN or negative sizes', () => {
    expect(formatBrowserBytes(0)).toBe('0 B');
    expect(formatBrowserBytes(1536)).toBe('1.5 KB');
    expect(formatBrowserBytes(0.5)).toBe('1 B');
    expect(formatBrowserBytes(-1)).toBe('0 B');
    expect(formatBrowserBytes(Number.NaN)).toBe('0 B');
  });

  it('clamps known progress and leaves unknown totals indeterminate', () => {
    expect(browserDownloadProgress(50, 100)).toBe(50);
    expect(browserDownloadProgress(120, 100)).toBe(100);
    expect(browserDownloadProgress(-10, 100)).toBe(0);
    expect(browserDownloadProgress(50, 0)).toBeNull();
    expect(browserDownloadProgress(Number.NaN, 100)).toBeNull();
  });
});
