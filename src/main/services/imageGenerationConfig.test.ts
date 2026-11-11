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
