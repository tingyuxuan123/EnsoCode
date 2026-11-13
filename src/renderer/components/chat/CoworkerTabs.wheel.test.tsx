// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoworkerTabs } from './CoworkerTabs';

const mock = vi.hoisted(() => ({
  state: {
    conversations: {} as Record<string, unknown>,
    selectTab: vi.fn(),
  },
  settings: { agentTypes: [], disabledBuiltinAgentTypes: [], designEnabled: true },
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (s: object) => unknown) => selector(mock.settings),
}));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: Object.assign((selector: (s: object) => unknown) => selector(mock.state), {
    getState: () => mock.state,
  }),
}));
vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => children,
  ContextMenuTrigger: ({ render }: { render: React.ReactNode }) => render,
  ContextMenuPopup: () => null,
  ContextMenuItem: () => null,
}));
vi.mock('@/components/ui/menu', () => ({
  Menu: ({ children }: { children: React.ReactNode }) => children,
  MenuTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement('button', { ...props, type: 'button' }, children),
  MenuPopup: () => null,
  MenuItem: () => null,
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? children : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => children,
  DialogDescription: () => null,
  DialogFooter: () => null,
  DialogHeader: () => null,
  DialogPanel: ({ children }: { children: React.ReactNode }) => children,
  DialogTitle: () => null,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => children,
  SelectPopup: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ value }: { value: string }) => createElement('span', { 'data-agent-type': value }),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

let mountedRoot: Root | null = null;
let mountedContainer: HTMLElement | null = null;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mock.state.selectTab.mockClear();
  mock.state.conversations = {
    parent: { id: 'parent', title: 'Main', started: true, coworkerIds: ['coworker'] },
    coworker: {
      id: 'coworker',
      parentId: 'parent',
      title: 'Persistent test',
      child: {
        mode: 'coworker',
        parentId: 'parent',
        agentInstanceId: 'agent',
        agentInstanceName: 'Persistent test',
        dispatchOrigin: 'manual',
      },
    },
  };
});

afterEach(async () => {
  if (mountedRoot) {
    const root = mountedRoot;
    mountedRoot = null;
    await act(async () => root.unmount());
  }
  mountedContainer?.remove();
  mountedContainer = null;
  vi.unstubAllGlobals();
});

/** 页签条是横向滚动容器，但 happy-dom 不做布局：显式给出可视/内容宽度与可写 scrollLeft。 */
function mountWithMetrics(options: {
  clientWidth: number;
  scrollWidth: number;
  scrollLeft?: number;
}): Promise<HTMLElement> {
  return (async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;
    await act(async () =>
      root.render(createElement(CoworkerTabs, { parentId: 'parent', displayedId: 'parent' }))
    );
    const scroller = container.querySelector<HTMLElement>(
      '[data-slot="conversation-tab-scroller"]'
    );
    if (!scroller) throw new Error('missing scroller');
    let scrollLeft = options.scrollLeft ?? 0;
    Object.defineProperty(scroller, 'clientWidth', {
      configurable: true,
      get: () => options.clientWidth,
    });
    Object.defineProperty(scroller, 'scrollWidth', {
      configurable: true,
      get: () => options.scrollWidth,
    });
    Object.defineProperty(scroller, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = value;
      },
    });
    return scroller;
  })();
}

function wheel(el: HTMLElement, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  // happy-dom 的 WheelEvent 不携带修饰键，按浏览器行为补上再派发。
  for (const key of ['ctrlKey', 'shiftKey', 'altKey', 'metaKey'] as const) {
    if (init[key]) Object.defineProperty(event, key, { value: true });
  }
  el.dispatchEvent(event);
  return event;
}

describe('会话页签条纵向滚轮横向滚动', () => {
  it('有横向溢出时，普通滚轮向下向右、向上向左，并阻止页面滚动', async () => {
    const scroller = await mountWithMetrics({ clientWidth: 200, scrollWidth: 500 });
    const down = wheel(scroller, { deltaY: 120 });
    expect(down.defaultPrevented).toBe(true);
    expect(scroller.scrollLeft).toBe(120);
    const up = wheel(scroller, { deltaY: -80 });
    expect(up.defaultPrevented).toBe(true);
    expect(scroller.scrollLeft).toBe(40);
  });

  it('位移被限制在左右边界内', async () => {
    const scroller = await mountWithMetrics({ clientWidth: 200, scrollWidth: 500 });
    const down = wheel(scroller, { deltaY: 1000 });
    expect(down.defaultPrevented).toBe(true);
    expect(scroller.scrollLeft).toBe(300);
    const up = wheel(scroller, { deltaY: -1000 });
    expect(up.defaultPrevented).toBe(true);
    expect(scroller.scrollLeft).toBe(0);
  });

  it('没有横向溢出时完全放行，不吞页面滚动', async () => {
    const scroller = await mountWithMetrics({ clientWidth: 200, scrollWidth: 200 });
    const down = wheel(scroller, { deltaY: 120 });
    expect(down.defaultPrevented).toBe(false);
    expect(scroller.scrollLeft).toBe(0);
  });

  it('已到可滚动边界时放行，不吞页面滚动', async () => {
    const scroller = await mountWithMetrics({
      clientWidth: 200,
      scrollWidth: 500,
      scrollLeft: 300,
    });
    const furtherRight = wheel(scroller, { deltaY: 120 });
    expect(furtherRight.defaultPrevented).toBe(false);
    expect(scroller.scrollLeft).toBe(300);
    scroller.scrollLeft = 0;
    const furtherLeft = wheel(scroller, { deltaY: -120 });
    expect(furtherLeft.defaultPrevented).toBe(false);
    expect(scroller.scrollLeft).toBe(0);
  });

  it('原生横向 deltaX 滚轮不被接管', async () => {
    const scroller = await mountWithMetrics({ clientWidth: 200, scrollWidth: 500 });
    const horizontal = wheel(scroller, { deltaX: 120, deltaY: 0 });
    expect(horizontal.defaultPrevented).toBe(false);
    expect(scroller.scrollLeft).toBe(0);
  });

  it('Shift+滚轮与 Ctrl+滚轮（缩放）不被接管', async () => {
    const scroller = await mountWithMetrics({ clientWidth: 200, scrollWidth: 500 });
    const shifted = wheel(scroller, { deltaY: 120, shiftKey: true });
    expect(shifted.defaultPrevented).toBe(false);
    expect(scroller.scrollLeft).toBe(0);
    const zoom = wheel(scroller, { deltaY: 120, ctrlKey: true });
    expect(zoom.defaultPrevented).toBe(false);
    expect(scroller.scrollLeft).toBe(0);
  });

  it('按行/页上报的 deltaMode 换算成合理像素距离', async () => {
    const scroller = await mountWithMetrics({ clientWidth: 200, scrollWidth: 500 });
    const lines = wheel(scroller, { deltaY: 3, deltaMode: 1 });
    expect(lines.defaultPrevented).toBe(true);
    expect(scroller.scrollLeft).toBeGreaterThan(0);
    expect(scroller.scrollLeft).toBeLessThanOrEqual(120);
    scroller.scrollLeft = 0;
    const pages = wheel(scroller, { deltaY: 1, deltaMode: 2 });
    expect(pages.defaultPrevented).toBe(true);
    expect(scroller.scrollLeft).toBe(200);
  });

  it('组件卸载后移除监听，不再改 scrollLeft 或吞事件', async () => {
    const scroller = await mountWithMetrics({ clientWidth: 200, scrollWidth: 500 });
    const root = mountedRoot!;
    mountedRoot = null;
    await act(async () => root.unmount());
    const afterUnmount = wheel(scroller, { deltaY: 120 });
    expect(afterUnmount.defaultPrevented).toBe(false);
    expect(scroller.scrollLeft).toBe(0);
  });

  it('滚轮横向滚动后页签选择行为不变', async () => {
    const scroller = await mountWithMetrics({ clientWidth: 200, scrollWidth: 500 });
    wheel(scroller, { deltaY: 120 });
    const coworkerTab = scroller.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
    await act(async () => coworkerTab.click());
    expect(mock.state.selectTab).toHaveBeenCalledWith('parent', 'coworker');
  });
});
