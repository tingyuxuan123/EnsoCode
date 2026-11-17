// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  providers: [] as { id: string; name: string; models: { id: string }[] }[],
}));

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/modelDirectory/useProviders', () => ({
  useUsableProviders: () => state.providers,
}));
// Base UI 的弹层在 happy-dom 里不可靠；这里只暴露「选模式」与「选模型」两个动作。
vi.mock('@/components/ui/select', () => {
  const Slot = ({ children }: { children?: import('react').ReactNode }) => <div>{children}</div>;
  return {
    Select: ({
      items,
      value,
      onValueChange,
      children,
    }: {
      items: Record<string, string>;
      value: string;
      onValueChange: (value: string) => void;
      children?: import('react').ReactNode;
    }) => (
      <div data-mode={value}>
        {children}
        {Object.entries(items).map(([key, label]) => (
          <button key={key} type="button" data-pick-mode={key} onClick={() => onValueChange(key)}>
            {label}
          </button>
        ))}
      </div>
    ),
    SelectTrigger: Slot,
    SelectValue: Slot,
    SelectPopup: Slot,
    SelectItem: ({
      value,
      disabled,
      children,
    }: {
      value: string;
      disabled?: boolean;
      children?: import('react').ReactNode;
    }) => (
      <div data-item={value} data-disabled={disabled ? 'true' : 'false'}>
        {children}
      </div>
    ),
  };
});
vi.mock('@/components/chat/ModelPicker', () => ({
  MODEL_PICKER_FORM_TRIGGER_CLASS: '',
  ModelPicker: (props: {
    providerId: string;
    modelId: string;
    emptyLabel?: string;
    onSelect: (providerId: string, modelId: string) => void;
  }) => (
    <button
      type="button"
      data-picker={`${props.providerId}|${props.modelId}|${props.emptyLabel ?? ''}`}
      onClick={() => props.onSelect('p2', 'm2')}
    >
      picker
    </button>
  ),
}));

import { PluginModelConfigField } from './PluginModelConfigField';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.providers = [{ id: 'p1', name: 'P1', models: [{ id: 'm1' }] }];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(value: string) {
  const onChange = vi.fn();
  await act(async () => root.render(<PluginModelConfigField value={value} onChange={onChange} />));
  return onChange;
}

it('空值和 session 都落到「跟随当前会话」，切标题模型只提交 title', async () => {
  for (const value of ['', 'session']) {
    const onChange = await render(value);
    expect(container.querySelector('[data-mode]')?.getAttribute('data-mode')).toBe('session');
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-pick-mode="title"]')?.click()
    );
    expect(onChange).toHaveBeenLastCalledWith('title');
  }
});

it('指定模型时回显已选模型，选中新模型提交 providerId::modelId', async () => {
  const onChange = await render('p1::m1');
  expect(container.querySelector('[data-mode]')?.getAttribute('data-mode')).toBe('fixed');
  expect(container.querySelector('[data-picker]')?.getAttribute('data-picker')).toBe(
    'p1|m1|Choose a model'
  );
  await act(async () => container.querySelector<HTMLButtonElement>('[data-picker]')?.click());
  expect(onChange).toHaveBeenLastCalledWith('p2::m2');
});

it('模型已不可用时明确警告，不假装还能跑', async () => {
  await render('gone::missing');
  expect(container.querySelector('[data-picker]')?.getAttribute('data-picker')).toBe(
    '||Choose a model'
  );
  expect(container.textContent).toContain(
    'The selected model is no longer available. Runs will fail until you pick another.'
  );
});

it('没有任何可用模型时不能切到「指定模型」', async () => {
  state.providers = [];
  const onChange = await render('session');
  expect(container.querySelector('[data-item="fixed"]')?.getAttribute('data-disabled')).toBe(
    'true'
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-pick-mode="fixed"]')?.click()
  );
  expect(onChange).not.toHaveBeenCalled();
});
