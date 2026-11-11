import { describe, expect, it } from 'vitest';
import * as images from './imageGeneration';

const id = '12345678-1234-4123-8123-123456789abc';

describe('生图参数', () => {
  it('清理模型填入的空可选项，并归一化尺寸', () => {
    const input = images.normalizeImageGenerationArgs({
      prompt: '  夜晚的窗户  ',
      size: ' 1024 × 1536 ',
      sourceImageId: '',
      sourceImagePath: null,
    });
    expect(images.parseImageGenerationArgs('generate_image', input)).toEqual({
      prompt: '夜晚的窗户',
      size: '1024x1536',
    });
  });

  it('改图只接受一个来源，文生图不接受来源或请求目标', () => {
    expect(images.parseImageGenerationArgs('edit_image', { prompt: 'a' })).toBeNull();
    expect(
      images.parseImageGenerationArgs('edit_image', { prompt: 'a', sourceImageId: id })
    ).toEqual({
      prompt: 'a',
      sourceImageId: id,
    });
    for (const input of [
      { prompt: 'a', sourceImageId: id, sourceImagePath: 'a.png' },
      { prompt: 'a', sourceImageId: 'not-an-id' },
      { prompt: 'a', sourceImagePath: 'a\0.png' },
    ])
      expect(images.parseImageGenerationArgs('edit_image', input)).toBeNull();
    expect(
      images.parseImageGenerationArgs('generate_image', { prompt: 'a', sourceImageId: id })
    ).toBeNull();
    expect(
      images.parseImageGenerationArgs('generate_image', {
        prompt: 'a',
        baseUrl: 'http://localhost',
      })
    ).toBeNull();
    expect(
      images.parseImageGenerationArgs('generate_image', { prompt: 'a', size: '9999x1' })
    ).toBeNull();
  });

  it('图片引用只接受 id 和 MIME 对应的固定项目内文件', () => {
    const image = { id, path: `.xiaoman/images/${id}.png`, mimeType: 'image/png' };
    expect(images.parseGeneratedImage(image)).toEqual(image);
    expect(images.parseGeneratedImage({ ...image, path: '../outside.png' })).toBeNull();
    expect(images.parseGeneratedImage({ ...image, mimeType: 'image/jpeg' })).toBeNull();
    expect(images.parseGeneratedImage({ ...image, bytes: '...' })).toBeNull();
  });

  it('只从成功工具输出解析图片，失败和伪造路径不生成预览', () => {
    const image = { id, path: `.xiaoman/images/${id}.png`, mimeType: 'image/png' };
    expect(images.generatedImageFromOutput(JSON.stringify({ ok: true, image }))).toEqual(image);
    expect(images.generatedImageFromOutput(JSON.stringify({ ok: false, image }))).toBeNull();
    expect(
      images.generatedImageFromOutput(
        JSON.stringify({ ok: true, image: { ...image, path: '/private.png' } })
      )
    ).toBeNull();
    expect(images.generatedImageFromOutput('not-json')).toBeNull();
  });

  it('设置只接受服务和模型标识，不接受附带凭证或 URL', () => {
    const value = { providerId: 'provider-1', modelId: 'gpt-image-1' };
    expect(images.parseImageGenerationSelection(value)).toEqual(value);
    expect(images.parseImageGenerationSelection({ ...value, apiKey: 'secret' })).toBeNull();
    expect(images.parseImageGenerationSelection({ ...value, modelId: ' ' })).toBeNull();
  });
});
