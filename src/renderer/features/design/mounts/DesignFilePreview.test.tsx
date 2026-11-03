import type { PluginPreviewFile } from '@vetta-org/plugin-sdk';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { LoadedDesignPreview } from '../host/preview-files';
import { DesignFilePreview } from './DesignFilePreview';

const h = vi.hoisted(() => ({ load: vi.fn(), t: (key: string) => key }));
vi.mock('../host/preview-files', () => ({ loadDesignPreviewFile: h.load }));
vi.mock('../host/translation', () => ({ useTranslation: () => ({ t: h.t }) }));
vi.mock('../vetta/src/preview/VetdPreview', () => ({
  VetdPreview: ({ file }: { file: PluginPreviewFile }) => <div data-file={file.path} />,
}));

it('换文件和卸载释放二进制URL，迟到读取也释放且不恢复旧owner预览', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let finish: (loaded: LoadedDesignPreview) => void = () => {};
  const first = {
    file: { path: '/a/share.vetdz' },
    actions: {},
    dispose: vi.fn(),
  } as unknown as LoadedDesignPreview;
  const second = {
    file: { path: '/b/share.vetdz' },
    actions: {},
    dispose: vi.fn(),
  } as unknown as LoadedDesignPreview;
  h.load
    .mockReset()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValueOnce(second);
  try {
    await act(async () =>
      root.render(<DesignFilePreview conversationId="a" rel="share.vetdz" revision={0} />)
    );
    await act(async () =>
      root.render(<DesignFilePreview conversationId="b" rel="share.vetdz" revision={0} />)
    );
    expect(container.querySelector('[data-file]')?.getAttribute('data-file')).toBe(
      '/b/share.vetdz'
    );
    expect(container.querySelector('[data-vetta-plugin-root]')).not.toBeNull();
    await act(async () => finish(first));
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-file]')?.getAttribute('data-file')).toBe(
      '/b/share.vetdz'
    );
  } finally {
    await act(async () => root.unmount());
    expect(second.dispose).toHaveBeenCalledOnce();
    container.remove();
    vi.unstubAllGlobals();
  }
});
