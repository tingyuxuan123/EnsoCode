import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_PROVIDER as defaults,
  imageOutputParams,
  normalizeImageModelIds,
  normalizeImageProviderBaseUrl,
  parseImageExtraParams,
  parseImageProviderPatch,
  parseImageProviderSettings,
} from './imageProvider';

describe('独立图片服务配置', () => {
  it('地址只接受 http(s) 根地址，拒绝凭据、查询和片段', () => {
    expect(normalizeImageProviderBaseUrl(' https://example.com/v1/ ')).toBe(
      'https://example.com/v1'
    );
    for (const value of [
      'file:///tmp/key',
      'https://user:pw@example.com/v1',
      'https://example.com/v1?key=x',
      'https://example.com/#x',
      null,
    ])
      expect(normalizeImageProviderBaseUrl(value)).toBeNull();
  });
  it('手输模型去重并保留首项默认顺序', () => {
    expect(normalizeImageModelIds('gpt-image-2， flux-1, gpt-image-2\ncustom')).toEqual([
      'gpt-image-2',
      'flux-1',
      'custom',
    ]);
    expect(parseImageProviderSettings(defaults)).toEqual(defaults);
    expect(parseImageProviderPatch({ quality: 'high' })).toEqual({ quality: 'high' });
    expect(parseImageProviderPatch({ apiKey: 'do-not-store' })).toBeNull();
    expect(parseImageProviderPatch({ models: [null] })).toBeNull();
  });
  it('1K/2K/4K 按长边缩放、对齐16像素且保留宽高比', () => {
    expect(imageOutputParams({ ...defaults, sizeMode: '1k' }, '1536x1024')).toEqual({
      size: '1024x688',
    });
    expect(imageOutputParams({ ...defaults, sizeMode: '2k' }, '1536x1024')).toEqual({
      size: '2048x1360',
    });
    expect(imageOutputParams({ ...defaults, sizeMode: '4k' }, '1024x1536')).toEqual({
      size: '2560x3840',
    });
  });
  it('跟随、不传和固定尺寸均能真正控制请求', () => {
    expect(imageOutputParams(defaults, '1536x1024')).toEqual({ size: '1536x1024' });
    expect(imageOutputParams(defaults)).toEqual({});
    expect(imageOutputParams({ ...defaults, sizeMode: 'omit' }, '1536x1024')).toEqual({});
    expect(
      imageOutputParams({ ...defaults, sizeMode: 'custom', customSize: '512x768' }, '1536x1024')
    ).toEqual({ size: '512x768' });
    expect(parseImageProviderPatch({ customSize: '99999x99999' })).toBeNull();
  });
  it('额外 JSON 可覆盖输出选项，但不能覆盖输入、数量或图片', () => {
    const config = {
      ...defaults,
      sizeMode: '2k' as const,
      quality: 'high',
      extraParams: JSON.stringify({
        size: '1024x1024',
        quality: 'medium',
        output_format: 'png',
        background: 'auto',
        model: 'evil',
        prompt: 'evil',
        n: 8,
        image: 'evil',
        mask: 'evil',
      }),
    };
    expect(imageOutputParams(config, '1536x1024')).toEqual({
      size: '1024x1024',
      quality: 'medium',
      output_format: 'png',
      background: 'auto',
    });
    for (const value of [
      '[]',
      'null',
      '{',
      '{"__proto__":{"polluted":true}}',
      '{"x":{"constructor":{}}}',
    ])
      expect(parseImageExtraParams(value)).toBeNull();
    expect(parseImageExtraParams(' ')).toEqual({});
  });
});
