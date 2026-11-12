import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_PROVIDER, imageOutputParams, parseImageExtraParams } from './imageProvider';
import {
  DEFAULT_IMAGE_STUDIO_OPTIONS,
  IMAGE_STUDIO_FORMATS,
  IMAGE_STUDIO_PROMPT_MAX,
  IMAGE_STUDIO_QUALITIES,
  IMAGE_STUDIO_RATIOS,
  IMAGE_STUDIO_RESOLUTIONS,
  IMAGE_STUDIO_THUMB_EDGE,
  imageStudioTitleFromPrompt,
  parseImageStudioGenerateRequest,
  parseImageStudioImageVariant,
  parseImageStudioOptions,
  parseImageStudioSessionId,
  studioOutputSettings,
  studioRequestedSize,
  studioThumbnailSize,
} from './imageStudio';

const UUID = '8f38ea6e-7f0f-4a47-9e57-2a5f8a24b0a1';

const options = {
  count: 1,
  model: 'gpt-image-1',
  ratio: '16:9',
  resolution: '2k',
  quality: 'high',
  format: 'webp',
} as const;

describe('Image Studio 契约常量', () => {
  it('比例、分辨率、质量、格式列表按契约固定顺序', () => {
    expect(IMAGE_STUDIO_RATIOS).toEqual([
      'auto',
      '1:1',
      '2:3',
      '3:2',
      '3:4',
      '4:3',
      '9:16',
      '16:9',
    ]);
    expect(IMAGE_STUDIO_RESOLUTIONS).toEqual(['auto', '1k', '2k', '4k']);
    expect(IMAGE_STUDIO_QUALITIES).toEqual(['auto', 'low', 'medium', 'high']);
    expect(IMAGE_STUDIO_FORMATS).toEqual(['auto', 'png', 'jpeg', 'webp']);
  });

  it('默认选项全部是 auto、模型为空', () => {
    expect(DEFAULT_IMAGE_STUDIO_OPTIONS).toEqual({
      count: 1,
      model: '',
      ratio: 'auto',
      resolution: 'auto',
      quality: 'auto',
      format: 'auto',
    });
  });
});

describe('parseImageStudioOptions', () => {
  it('数量仅允许 1–10 的整数，旧选项缺省为 1', () => {
    for (const count of [1, 2, 3, 10])
      expect(parseImageStudioOptions({ ...options, count })?.count).toBe(count);
    for (const count of [0, -1, 11, 1.5, NaN, Infinity, '3', null, true])
      expect(parseImageStudioOptions({ ...options, count })).toBeNull();
    expect(parseImageStudioOptions({ model: 'legacy' })?.count).toBe(1);
  });
  it('接受完整合法选项', () => {
    expect(parseImageStudioOptions(options)).toEqual(options);
  });

  it('缺失字段回落到默认值，模型两端空白被去掉', () => {
    expect(parseImageStudioOptions({ ratio: '16:9', model: ' gpt-image-1 ' })).toEqual({
      ...DEFAULT_IMAGE_STUDIO_OPTIONS,
      ratio: '16:9',
      model: 'gpt-image-1',
    });
    expect(parseImageStudioOptions({})).toEqual(DEFAULT_IMAGE_STUDIO_OPTIONS);
  });

  it('未知字段、未知取值、错误类型一律拒绝', () => {
    expect(parseImageStudioOptions({ ...options, size: '1024x1024' })).toBeNull();
    expect(parseImageStudioOptions({ ...options, path: '/etc/passwd' })).toBeNull();
    expect(parseImageStudioOptions({ ...options, ratio: '5:4' })).toBeNull();
    expect(parseImageStudioOptions({ ...options, resolution: '8k' })).toBeNull();
    expect(parseImageStudioOptions({ ...options, quality: 'ultra' })).toBeNull();
    expect(parseImageStudioOptions({ ...options, format: 'gif' })).toBeNull();
    expect(parseImageStudioOptions({ ...options, model: 1 })).toBeNull();
    expect(parseImageStudioOptions({ ...options, model: 'gpt image' })).toBeNull();
    expect(parseImageStudioOptions({ ...options, model: 'a'.repeat(257) })).toBeNull();
    expect(parseImageStudioOptions(null)).toBeNull();
    expect(parseImageStudioOptions('auto')).toBeNull();
    expect(parseImageStudioOptions([])).toBeNull();
  });
});

describe('parseImageStudioGenerateRequest', () => {
  it('接受合法请求并把会话/参考图 id 归一化为小写', () => {
    expect(
      parseImageStudioGenerateRequest({
        sessionId: UUID.toUpperCase(),
        prompt: '  一只猫  ',
        options,
        sourceImageId: UUID.toUpperCase(),
      })
    ).toEqual({ sessionId: UUID, prompt: '一只猫', options, sourceImageId: UUID });
  });

  it('不传参考图时不伪造字段', () => {
    const parsed = parseImageStudioGenerateRequest({ sessionId: UUID, prompt: '猫', options });
    expect(parsed).toEqual({ sessionId: UUID, prompt: '猫', options });
    expect(parsed && 'sourceImageId' in parsed).toBe(false);
  });

  it('会话 id 必须是 UUID，绝不接受路径片段', () => {
    for (const sessionId of ['../evil', '..', '/etc/passwd', `${UUID}/../../x`, '', 1, null]) {
      expect(parseImageStudioGenerateRequest({ sessionId, prompt: '猫', options })).toBeNull();
    }
  });

  it('参考图 id 必须是 UUID', () => {
    expect(
      parseImageStudioGenerateRequest({
        sessionId: UUID,
        prompt: '猫',
        options,
        sourceImageId: '../a',
      })
    ).toBeNull();
  });

  it('提示词不能为空、不能超长', () => {
    expect(parseImageStudioGenerateRequest({ sessionId: UUID, prompt: '   ', options })).toBeNull();
    expect(
      parseImageStudioGenerateRequest({
        sessionId: UUID,
        prompt: 'a'.repeat(IMAGE_STUDIO_PROMPT_MAX + 1),
        options,
      })
    ).toBeNull();
    expect(
      parseImageStudioGenerateRequest({
        sessionId: UUID,
        prompt: 'a'.repeat(IMAGE_STUDIO_PROMPT_MAX),
        options,
      })?.prompt
    ).toHaveLength(IMAGE_STUDIO_PROMPT_MAX);
  });

  it('未知字段与坏选项拒绝', () => {
    expect(
      parseImageStudioGenerateRequest({
        sessionId: UUID,
        prompt: '猫',
        options,
        path: '/tmp/a.png',
      })
    ).toBeNull();
    expect(
      parseImageStudioGenerateRequest({ sessionId: UUID, prompt: '猫', options: { ratio: '5:4' } })
    ).toBeNull();
    expect(parseImageStudioGenerateRequest(null)).toBeNull();
  });
});

describe('parseImageStudioSessionId', () => {
  it('只接受 UUID', () => {
    expect(parseImageStudioSessionId(UUID)).toBe(UUID);
    expect(parseImageStudioSessionId('..')).toBeNull();
    expect(parseImageStudioSessionId({ id: UUID })).toBeNull();
  });
});

describe('studioRequestedSize', () => {
  it('比例与分辨率都为 auto 时不指定尺寸（沿用 provider 默认）', () => {
    expect(studioRequestedSize('auto', 'auto')).toBeUndefined();
  });

  it('auto 比例按方图，分辨率决定最长边', () => {
    expect(studioRequestedSize('auto', '1k')).toBe('1024x1024');
    expect(studioRequestedSize('auto', '2k')).toBe('2048x2048');
    expect(studioRequestedSize('auto', '4k')).toBe('3840x3840');
  });

  it('auto 分辨率用 1k 基准，比例决定宽高', () => {
    expect(studioRequestedSize('1:1', 'auto')).toBe('1024x1024');
    expect(studioRequestedSize('16:9', 'auto')).toBe('1024x576');
    expect(studioRequestedSize('9:16', 'auto')).toBe('576x1024');
    expect(studioRequestedSize('4:3', 'auto')).toBe('1024x768');
  });

  it('4k 最长边是 3840，且宽高都是 16 的整数倍', () => {
    expect(studioRequestedSize('16:9', '4k')).toBe('3840x2160');
    expect(studioRequestedSize('3:2', '4k')).toBe('3840x2560');
    expect(studioRequestedSize('1:1', '4k')).toBe('3840x3840');
    expect(studioRequestedSize('2:3', '2k')).toBe('1360x2048');
    for (const ratio of IMAGE_STUDIO_RATIOS) {
      for (const resolution of IMAGE_STUDIO_RESOLUTIONS) {
        const size = studioRequestedSize(ratio, resolution);
        if (!size) continue;
        const [width, height] = size.split('x').map(Number);
        expect(width % 16).toBe(0);
        expect(height % 16).toBe(0);
        expect(width).toBeGreaterThanOrEqual(64);
        expect(height).toBeGreaterThanOrEqual(64);
        expect(Math.max(width, height)).toBeLessThanOrEqual(4096);
      }
    }
  });
});

describe('studioOutputSettings', () => {
  it('工作台显式选项优先于 provider 额外参数，全 auto 则保留默认值', () => {
    const base = {
      ...DEFAULT_IMAGE_PROVIDER,
      extraParams: '{"size":"auto","quality":"low","background":"opaque"}',
    };
    const output = studioOutputSettings(base, options);
    expect(
      imageOutputParams(output, studioRequestedSize(options.ratio, options.resolution))
    ).toMatchObject({
      size: '2048x1152',
      quality: 'high',
      background: 'opaque',
      output_format: 'webp',
    });
    expect(
      imageOutputParams(studioOutputSettings(base, DEFAULT_IMAGE_STUDIO_OPTIONS))
    ).toMatchObject({ size: 'auto', quality: 'low' });
  });
  const base = {
    ...DEFAULT_IMAGE_PROVIDER,
    sizeMode: 'custom' as const,
    customSize: '2048x2048',
    quality: 'high',
    extraParams: '{"background":"opaque"}',
  };

  it('全 auto 时完全沿用 provider 默认输出参数', () => {
    expect(studioOutputSettings(base, DEFAULT_IMAGE_STUDIO_OPTIONS)).toEqual(base);
  });

  it('只覆盖本次请求，不改动传入的 provider 配置', () => {
    const snapshot = JSON.parse(JSON.stringify(base));
    const plan = studioOutputSettings(base, options);
    expect(plan.sizeMode).toBe('2k');
    expect(plan.quality).toBe('high');
    expect(plan.imageToImage).toBe(base.imageToImage);
    expect(base).toEqual(snapshot);
  });

  it('指定比例但分辨率 auto 时按请求尺寸发送', () => {
    const plan = studioOutputSettings(base, { ...options, resolution: 'auto' });
    expect(plan.sizeMode).toBe('request');
  });

  it('quality 非 auto 覆盖，auto 保留 provider 质量', () => {
    expect(studioOutputSettings(base, { ...options, quality: 'low' }).quality).toBe('low');
    expect(studioOutputSettings(base, { ...options, quality: 'auto' }).quality).toBe('high');
  });

  it('format 非 auto 写进 output_format，auto 不动 provider 额外参数', () => {
    expect(parseImageExtraParams(studioOutputSettings(base, options).extraParams)).toEqual({
      background: 'opaque',
      output_format: 'webp',
    });
    expect(
      parseImageExtraParams(studioOutputSettings(base, { ...options, format: 'auto' }).extraParams)
    ).toEqual({ background: 'opaque' });
  });

  it('provider 额外参数损坏时不会因为 format 而抛出', () => {
    expect(() => studioOutputSettings({ ...base, extraParams: '{oops' }, options)).not.toThrow();
  });
});

describe('imageStudioTitleFromPrompt', () => {
  it('取首行、压缩空白并截断', () => {
    expect(imageStudioTitleFromPrompt('  一只\n\n  在窗台的猫  ')).toBe('一只 在窗台的猫');
    expect(imageStudioTitleFromPrompt('a'.repeat(200))).toHaveLength(60);
    expect(imageStudioTitleFromPrompt('   ')).toBe('');
  });
});

describe('图片读取变体', () => {
  it('缺省是 original，未知变体拒绝', () => {
    expect(parseImageStudioImageVariant(undefined)).toBe('original');
    expect(parseImageStudioImageVariant('original')).toBe('original');
    expect(parseImageStudioImageVariant('thumb')).toBe('thumb');
    for (const bad of ['large', '', null, 1, {}]) {
      expect(parseImageStudioImageVariant(bad)).toBeNull();
    }
  });

  it('缩略图长边不超过 480，不放大原图', () => {
    expect(IMAGE_STUDIO_THUMB_EDGE).toBe(480);
    expect(studioThumbnailSize(1000, 500)).toEqual({ width: 480, height: 240 });
    expect(studioThumbnailSize(500, 1000)).toEqual({ width: 240, height: 480 });
    expect(studioThumbnailSize(100, 50)).toEqual({ width: 100, height: 50 });
    expect(studioThumbnailSize(483, 100)).toEqual({ width: 480, height: 99 });
    expect(studioThumbnailSize(1, 1)).toEqual({ width: 1, height: 1 });
  });

  it('宽高非法时拒绝生成缩略图', () => {
    for (const [width, height] of [
      [0, 0],
      [0, 500],
      [-1, 500],
      [Number.NaN, 500],
      [500.5, 100],
    ]) {
      expect(studioThumbnailSize(width, height)).toBeNull();
    }
  });
});
