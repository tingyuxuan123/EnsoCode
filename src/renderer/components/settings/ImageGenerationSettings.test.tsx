// @vitest-environment happy-dom

import { DEFAULT_IMAGE_PROVIDER } from '@shared/imageProvider';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ImageProviderForm, type ImageProviderFormProps } from './ImageGenerationSettings';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({ useSettingsStore: () => null }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const props = (): ImageProviderFormProps => ({
  view: {
    configured: true,
    config: { ...DEFAULT_IMAGE_PROVIDER, models: ['gpt-image-2'], sizeMode: '2k', quality: 'high' },
    hasApiKey: true,
    secureStorageAvailable: true,
  },
  busy: false,
  error: '',
  selections: { textToImage: null, imageToImage: null },
  onSelect: vi.fn(),
  update: vi.fn(async () => true),
  saveConnection: vi.fn(async () => true),
  clearKey: vi.fn(async () => true),
  listModels: vi.fn(async () => ({ ok: true as const, value: { models: ['gpt-image-2'] } })),
});
describe('独立图片设置界面', () => {
  it('显示独立连接、加密状态、模型和真实输出预览，不再要求配置聊天服务', () => {
    const html = renderToStaticMarkup(<ImageProviderForm {...props()} />);
    expect(html).toContain('OpenAI-compatible image generation');
    expect(html).toContain('Output parameters');
    expect(html).toContain('2048x1360');
    expect(html).toContain('value=""');
    expect(html).not.toContain('Manage image services');
    expect(html).not.toContain('sk-');
  });
  it('尺寸切换写入设置，测试连接只走模型查询而非生成图片', async () => {
    const value = props();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<ImageProviderForm {...value} />));
      await act(async () => {
        [...container.querySelectorAll('button')]
          .find((button) => button.textContent === '4K')!
          .click();
      });
      expect(value.update).toHaveBeenCalledWith({ sizeMode: '4k' });
      await act(async () => {
        [...container.querySelectorAll('button')]
          .find((button) => button.textContent === 'Test connection')!
          .click();
      });
      expect(value.listModels).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain('Connection successful');
      expect(value.saveConnection).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
