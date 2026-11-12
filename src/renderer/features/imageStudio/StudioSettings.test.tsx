// @vitest-environment happy-dom
import { DEFAULT_IMAGE_STUDIO_OPTIONS } from '@shared/imageStudio';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudioSettings } from './StudioSettings';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, number>) =>
      key.replace('{{n}}', String(params?.n ?? '')),
  }),
}));
vi.mock('@/hooks/useTrafficLightsGuard', () => ({ useTrafficLightsGuard: () => {} }));
vi.mock('@/hooks/useOverlayGuard', () => ({ OverlayGuardHost: () => null }));
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});
describe('画图数量选择', () => {
  it('数量提供 1–10 张，选中三张只更新草稿，完成后才提交参数', async () => {
    const save = vi.fn();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <StudioSettings
          open
          onClose={vi.fn()}
          options={DEFAULT_IMAGE_STUDIO_OPTIONS}
          models={['gpt-image-1']}
          onSave={save}
        />
      )
    );
    const quantity = document.querySelector<HTMLButtonElement>('button[aria-label="Quantity"]');
    expect(quantity).not.toBeNull();
    await act(async () => quantity!.click());
    const choices = [...document.querySelectorAll<HTMLElement>('[role=option]')];
    expect(choices.map((choice) => choice.textContent)).toEqual(
      Array.from({ length: 10 }, (_, i) => (i === 0 ? '1 image' : `${i + 1} images`))
    );
    await act(async () => choices[2].click());
    expect(quantity?.textContent).toContain('3 images');
    expect(save).not.toHaveBeenCalled();
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === 'Done')!
        .click()
    );
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ count: 3 }));
  });
});
