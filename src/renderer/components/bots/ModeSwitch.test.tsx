// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModeSwitch } from './ModeSwitch';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const mode = vi.hoisted(() => ({ value: 'bot', set: vi.fn(), select: vi.fn() }));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (s: object) => unknown) => select({ keybindings: {} }),
}));
vi.mock('@/stores/bots', () => ({ useBotPendingCount: () => 0 }));
vi.mock('@/stores/bots/mode', () => ({
  useAppModeStore: (select: (s: object) => unknown) =>
    select({ mode: mode.value, setMode: mode.set }),
}));
vi.mock('./BotSidebar', () => ({ CountBadge: () => null }));
let dispose: (() => Promise<void>) | undefined;
afterEach(async () => {
  await dispose?.();
  vi.clearAllMocks();
});
describe('图标轨拆分的 Code / Bot 入口', () => {
  it('分别渲染入口，Bot 激活时 Code 未选中，点击 Code 保留宿主退出工作台回调', async () => {
    const container = document.createElement('nav');
    container.dataset.slot = 'app-rail';
    const root = createRoot(container);
    dispose = () => act(async () => root.unmount());
    await act(async () =>
      root.render(
        <>
          <ModeSwitch only="code" onSelect={mode.select} />
          <span>Images</span>
          <ModeSwitch only="bot" onSelect={mode.select} />
        </>
      )
    );
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Code', 'Bot']);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    await act(async () => buttons[0].click());
    expect(mode.set).toHaveBeenCalledWith('code');
    expect(mode.select).toHaveBeenCalledOnce();
  });
});
