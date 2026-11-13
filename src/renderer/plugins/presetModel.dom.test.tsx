// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PresetPicker } from '@/components/chat/PresetPicker';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: unknown) => unknown) => select({ presets: [] }),
}));
vi.mock('./usePluginPresets', async (original) => ({
  ...(await original<typeof import('./usePluginPresets')>()),
  useEnabledPluginPresets: () => [
    {
      id: 'plugin:local.test:fast',
      name: 'Fast',
      pluginName: 'Local',
      model: { providerId: 'provider', modelId: 'model' },
    },
    { id: 'plugin:local.test:plain', name: 'Plain', pluginName: 'Local' },
  ],
}));
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: import('react').ReactNode }) => children,
  PopoverTrigger: ({ children }: { children: import('react').ReactNode }) => (
    <span>{children}</span>
  ),
  PopoverPopup: ({ children }: { children: import('react').ReactNode }) => <div>{children}</div>,
}));
it('a user selecting a plugin preset changes its model, while a model-less preset preserves selection', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  const root = createRoot(container);
  const onSelect = vi.fn();
  const onModel = vi.fn();
  try {
    await act(async () =>
      root.render(<PresetPicker presetId="default" onSelect={onSelect} onModel={onModel} />)
    );
    const buttons = [...container.querySelectorAll('button')];
    await act(async () => buttons.find((button) => button.textContent?.includes('Fast'))?.click());
    expect(onSelect).toHaveBeenCalledWith('plugin:local.test:fast');
    expect(onModel).toHaveBeenCalledExactlyOnceWith({ providerId: 'provider', modelId: 'model' });
    await act(async () => buttons.find((button) => button.textContent?.includes('Plain'))?.click());
    expect(onSelect).toHaveBeenLastCalledWith('plugin:local.test:plain');
    expect(onModel).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
