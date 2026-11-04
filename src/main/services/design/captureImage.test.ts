import { expect, it } from 'vitest';
import { encodeCapturedImage, prefersNativeCapture } from './captureImage';

function fakeImage(scaleFactors: number[], empty = false) {
  const calls: unknown[] = [];
  return {
    calls,
    isEmpty: () => empty,
    getScaleFactors: () => scaleFactors,
    toPNG: (options?: { scaleFactor?: number }) => {
      calls.push(['png', options?.scaleFactor]);
      return Buffer.from(`png@${options?.scaleFactor}`);
    },
    toJPEG: (quality: number) => {
      calls.push(['jpeg', quality]);
      return Buffer.from(`jpeg@${quality}`);
    },
  };
}

it('Windows 隐藏窗口截图走 capturePage，其余平台保留 CDP 截图', () => {
  expect(prefersNativeCapture('win32')).toBe(true);
  expect(prefersNativeCapture('darwin')).toBe(false);
  expect(prefersNativeCapture('linux')).toBe(false);
});

it('PNG 取最高倍率表示，高 DPI 不被降采样', () => {
  const image = fakeImage([1, 1.25]);
  expect(encodeCapturedImage(image, 'png')).toBe(Buffer.from('png@1.25').toString('base64'));
  expect(image.calls).toEqual([['png', 1.25]]);
});

it('JPEG 质量按 0–1 换算成 1–100，缺省 0.92', () => {
  const image = fakeImage([1]);
  encodeCapturedImage(image, 'jpeg');
  encodeCapturedImage(image, 'jpeg', 0);
  encodeCapturedImage(image, 'jpeg', 0.5);
  expect(image.calls).toEqual([
    ['jpeg', 92],
    ['jpeg', 1],
    ['jpeg', 50],
  ]);
});

it('空图视为截图失败，不返回空 dataUrl', () => {
  expect(() => encodeCapturedImage(fakeImage([1], true), 'png')).toThrow(
    expect.objectContaining({ code: 'FAILED' })
  );
});
