import { describe, expect, it } from 'vitest';
import {
  applyLocalImageLoad,
  initialLocalImageSource,
  localImageErrorText,
} from './localImageSource';

const t = (key: string) => key;

describe('本地图片来源状态', () => {
  it('本机走 local-image:// 特权协议，远程宿主先进入加载态（不留空白）', () => {
    expect(initialLocalImageSource('/tmp/a.png', false)).toEqual({
      status: 'local',
      src: 'local-image://posix/tmp/a.png',
    });
    expect(initialLocalImageSource('/tmp/a.png', true)).toEqual({ status: 'loading' });
  });

  it('只接受 data:image 结果；错误码保留给界面翻文案', () => {
    expect(applyLocalImageLoad({ ok: true, dataUrl: 'data:image/png;base64,AA==' })).toEqual({
      status: 'ready',
      src: 'data:image/png;base64,AA==',
    });
    expect(applyLocalImageLoad({ ok: true, dataUrl: 'http://evil/a.png' })).toEqual({
      status: 'error',
      error: 'invalid',
    });
    expect(applyLocalImageLoad({ ok: false, error: 'too-large' })).toEqual({
      status: 'error',
      error: 'too-large',
    });
    expect(applyLocalImageLoad({ ok: false })).toEqual({ status: 'error', error: 'failed' });
  });

  it('每个失败原因都有可见文案，未知值也不空白', () => {
    for (const error of [
      'too-large',
      'unsupported',
      'not-found',
      'changed',
      'unavailable',
      'offline',
      'timeout',
      'outside',
      'failed',
    ])
      expect(localImageErrorText(error, t).length).toBeGreaterThan(0);
    expect(localImageErrorText('too-large', t)).toBe('Image is too large to preview on the phone');
    expect(localImageErrorText('mystery', t)).toBe('Could not load the image');
  });
});
