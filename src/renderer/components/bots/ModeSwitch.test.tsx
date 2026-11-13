// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModeSwitch } from './ModeSwitch';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
/** happy-dom 没有真实动画管线，取消 framer-motion 动画会抛 AbortError；这里只要结构化渲染。 */
vi.mock('framer-motion', () => {
  const passthrough = (tag: string) => (props: Record<string, unknown>) => {
    const { children, layoutId, initial, animate, exit, transition, ...rest } = props;
    void layoutId;
    void initial;
    void animate;
    void exit;
    void transition;
    return createElement(tag, rest, children as ReactNode);
  };
  return {
    motion: { div: passthrough('div'), span: passthrough('span') },
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    useReducedMotion: () => true,
  };
});
const mode = vi.hoisted(() => ({ value: 'code', set: vi.fn(), select: vi.fn(), pending: 0 }));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (s: object) => unknown) =>
    select({ keybindings: {}, botModeEnabled: true }),
}));
vi.mock('@/stores/bots', () => ({ useBotPendingCount: () => mode.pending }));
vi.mock('@/stores/bots/mode', () => ({
  useAppModeStore: (select: (s: object) => unknown) =>
    select({ mode: mode.value, setMode: mode.set }),
}));
vi.mock('./BotSidebar', () => ({
  CountBadge: ({ count }: { count: number }) => <span data-testid="pending">{count}</span>,
}));

let container: HTMLElement;
let root: Root;
const buttons = () => [...container.querySelectorAll<HTMLButtonElement>('button')];
const byLabel = (label: string) =>
  buttons().find((button) => button.getAttribute('aria-label') === label);

async function render(props: Parameters<typeof ModeSwitch>[0] = {}) {
  await act(async () => root.render(<ModeSwitch {...props} />));
}

beforeEach(() => {
  mode.value = 'code';
  mode.pending = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('标题栏 Code / Bot 分段控件', () => {
  it('两种模式都同时给出图标和文字，并带分组语义', async () => {
    await render();
    const group = container.querySelector('[data-slot="mode-switch"]');
    expect(group?.getAttribute('role')).toBe('group');
    expect(group?.getAttribute('aria-label')).toBe('Switch mode');
    expect(buttons().map((button) => button.getAttribute('aria-label'))).toEqual(['Code', 'Bot']);
    for (const button of buttons()) {
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button.textContent).not.toBe('');
      // 入口沿用图标轨的稳定钩子，验收脚本按 data-rail-view 定位工作模式。
      expect(button.dataset.railView).toBe(button.dataset.appMode);
    }
  });

  it('Code 模式下选中 Code、未选中 Bot', async () => {
    await render();
    expect(byLabel('Code')?.getAttribute('aria-pressed')).toBe('true');
    expect(byLabel('Bot')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('点击 Bot 切换工作模式并通知宿主退出工作台页面', async () => {
    await render({ onSelect: mode.select });
    await act(async () => byLabel('Bot')?.click());
    expect(mode.set).toHaveBeenCalledWith('bot');
    expect(mode.select).toHaveBeenCalledOnce();
  });

  it('点击已选中的 Code 仍通知宿主，从画廊 / 生图回到 Code 对话', async () => {
    await render({ onSelect: mode.select });
    await act(async () => byLabel('Code')?.click());
    expect(mode.set).toHaveBeenCalledWith('code');
    expect(mode.select).toHaveBeenCalledOnce();
  });

  it('Bot 实验开关关闭时只保留 Code 入口，不渲染 Bot', async () => {
    await render({ includeBot: false });
    expect(buttons().map((button) => button.getAttribute('aria-label'))).toEqual(['Code']);
    expect(byLabel('Code')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('画廊 / 生图 / 扩展页里两个分段都不算选中，但仍可点击回 Code', async () => {
    await render({ inactive: true, onSelect: mode.select });
    expect(byLabel('Code')?.getAttribute('aria-pressed')).toBe('false');
    expect(byLabel('Bot')?.getAttribute('aria-pressed')).toBe('false');
    await act(async () => byLabel('Code')?.click());
    expect(mode.set).toHaveBeenCalledWith('code');
    expect(mode.select).toHaveBeenCalledOnce();
  });

  it('方向键在两个可见分段之间移动选择', async () => {
    mode.value = 'bot';
    await render();
    await act(async () => {
      container
        .querySelector('[data-slot="mode-switch"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(mode.set).toHaveBeenCalledWith('code');
  });

  it('只有一个分段时方向键不制造假切换', async () => {
    await render({ includeBot: false });
    await act(async () => {
      container
        .querySelector('[data-slot="mode-switch"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(mode.set).not.toHaveBeenCalled();
  });

  it('Code 模式下 Bot 分段显示待处理数，Bot 模式下不再显示', async () => {
    mode.pending = 2;
    await render();
    expect(byLabel('Bot')?.textContent).toContain('2');
    mode.value = 'bot';
    await render();
    expect(container.querySelector('[data-testid="pending"]')).toBeNull();
  });
});
