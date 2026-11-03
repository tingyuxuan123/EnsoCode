import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ScreenshotSwiper } from '../vetta/src/cards/ScreenshotSwiper';

const { readBinaryFile } = vi.hoisted(() => ({ readBinaryFile: vi.fn() }));
vi.mock('../vetta/src/plugin-context', () => ({
  getPluginCtx: () => ({ fs: { readBinaryFile } }),
}));
vi.mock('@vetta-org/plugin-sdk', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.restoreAllMocks());

it('releases a binary read that finishes after its virtualized card was unmounted', async () => {
  let finish: ((value: { data: string; mimeType: string; size: number }) => void) | undefined;
  readBinaryFile.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:late-shot');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() =>
    root.render(
      <ScreenshotSwiper
        snapshots={[{ path: '/w/a.vetd/.snapshots/home-1.png', capturedAt: 1 }]}
        leadingSkeleton={false}
      />
    )
  );
  act(() => root.unmount());
  await act(async () => {
    finish?.({ data: 'AA==', mimeType: 'image/png', size: 1 });
  });
  expect(create).toHaveBeenCalledTimes(1);
  expect(revoke).toHaveBeenCalledWith('blob:late-shot');
});
