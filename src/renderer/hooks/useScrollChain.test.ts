import { describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
}));

import { useScrollChain } from './useScrollChain';

function mount(scrollTop: number, hasOuter = true, delayed = false) {
  const outer = { scrollBy: vi.fn() };
  let onWheel: (event: WheelEvent) => void = () => {};
  const element = {
    scrollTop,
    clientHeight: 100,
    scrollHeight: 300,
    closest: vi.fn(() => (hasOuter ? outer : null)),
    addEventListener: vi.fn((_name: string, handler: (event: WheelEvent) => void) => {
      onWheel = handler;
    }),
    removeEventListener: vi.fn(),
  };
  // biome-ignore lint/correctness/useHookAtTopLevel: React hooks are mocked to exercise the wheel listener in node.
  const ref = useScrollChain();
  if (delayed) ref(null);
  const cleanup = ref(element as unknown as HTMLDivElement);
  const wheel = (deltaY: number) => {
    const preventDefault = vi.fn();
    onWheel({ deltaY, preventDefault } as unknown as WheelEvent);
    return preventDefault;
  };
  return { element, outer, wheel, cleanup };
}

describe('useScrollChain', () => {
  it('异步加载后才出现的列表仍能把边界滚轮交给外层', () => {
    const { outer, wheel } = mount(200, true, true);
    expect(wheel(40)).toHaveBeenCalledOnce();
    expect(outer.scrollBy).toHaveBeenCalledWith({ top: 40 });
  });

  it.each([
    [0, -40],
    [200, 40],
    [199.5, 40],
  ])('在边界 %s 把滚轮 %s 交给外层', (scrollTop, deltaY) => {
    const { outer, wheel } = mount(scrollTop);
    expect(wheel(deltaY)).toHaveBeenCalledOnce();
    expect(outer.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: deltaY });
  });

  it.each([
    [100, 40],
    [100, -40],
    [0, 40],
    [200, -40],
    [0, 0],
  ])('内部仍能滚动或没有垂直增量时不接管：%s / %s', (scrollTop, deltaY) => {
    const { outer, wheel } = mount(scrollTop);
    expect(wheel(deltaY)).not.toHaveBeenCalled();
    expect(outer.scrollBy).not.toHaveBeenCalled();
  });

  it('内容没有溢出时也能向外层滚动', () => {
    const { element, outer, wheel } = mount(0);
    element.scrollHeight = element.clientHeight;
    wheel(50);
    expect(outer.scrollBy).toHaveBeenCalledWith({ top: 50 });
  });

  it('没有外层时保留原生滚轮行为', () => {
    const { wheel } = mount(0, false);
    expect(wheel(-40)).not.toHaveBeenCalled();
  });

  it('卸载时移除同一个滚轮监听器', () => {
    const { element, cleanup } = mount(0);
    const handler = element.addEventListener.mock.calls[0][1];
    cleanup?.();
    expect(element.removeEventListener).toHaveBeenCalledWith('wheel', handler);
  });
});
