import { DEFAULT_IMAGE_PROVIDER, IMAGE_PROVIDER_ID } from '@shared/imageProvider';
import { describe, expect, it } from 'vitest';
import { resolveImageProvider } from './imageGenerationConfig';

const selection = { providerId: 'images', modelId: 'gpt-image-1' };
const provider = {
  id: 'images',
  enabled: true,
  api: 'openai-completions',
  baseUrl: 'https://example.com/v1',
  apiKey: 'secret',
};
const state = {
  imageGeneration: { textToImage: selection, imageToImage: null },
  providers: [provider],
};

describe('生图凭证选择', () => {
  it('独立图片服务配置优先，不再依赖聊天服务，首模型默认且支持关闭编辑', () => {
    const independent = {
      config: { ...DEFAULT_IMAGE_PROVIDER, models: ['gpt-image-2'] },
      apiKey: 'image-secret',
    };
    expect(resolveImageProvider({}, 'generate_image', independent)).toMatchObject({
      baseUrl: independent.config.baseUrl,
      apiKey: 'image-secret',
      modelId: 'gpt-image-2',
      output: independent.config,
    });
    expect(
      resolveImageProvider(state, 'edit_image', {
        ...independent,
        config: { ...independent.config, imageToImage: false },
      })
    ).toBeNull();
    expect(
      resolveImageProvider(state, 'generate_image', { ...independent, apiKey: '' })
    ).toBeNull();
  });
  it('显式选中新图片模型被删除后不偷偷换模型，未配置新服务仍兼容旧引用', () => {
    const independent = {
      config: { ...DEFAULT_IMAGE_PROVIDER, models: ['gpt-image-2'] },
      apiKey: 'image-secret',
    };
    const chosen = {
      imageGeneration: { textToImage: { providerId: IMAGE_PROVIDER_ID, modelId: 'removed' } },
    };
    expect(resolveImageProvider(chosen, 'generate_image', independent)).toBeNull();
    expect(resolveImageProvider(state, 'generate_image', undefined)?.apiKey).toBe('secret');
  });
  it('只从 Main 权威设置按标识取凭证，模型不必在聊天模型列表里', () => {
    expect(resolveImageProvider(state, 'generate_image')).toEqual({
      baseUrl: provider.baseUrl,
      apiKey: 'secret',
      modelId: 'gpt-image-1',
    });
  });
  it('改图不偷偷回退文生图服务，删除或禁用服务后不可用', () => {
    expect(resolveImageProvider(state, 'edit_image')).toBeNull();
    expect(resolveImageProvider({ ...state, providers: [] }, 'generate_image')).toBeNull();
    expect(
      resolveImageProvider(
        { ...state, providers: [{ ...provider, enabled: false }] },
        'generate_image'
      )
    ).toBeNull();
  });
  it('订阅 OAuth 和前端脱敏引用不能充当图片 API key', () => {
    for (const patch of [
      { apiKey: 'enso-secret:abc' },
      { apiKey: '' },
      { oauthAccountKey: 'openai-codex' },
    ])
      expect(
        resolveImageProvider({ ...state, providers: [{ ...provider, ...patch }] }, 'generate_image')
      ).toBeNull();
    expect(resolveImageProvider(null, 'generate_image')).toBeNull();
  });
});
