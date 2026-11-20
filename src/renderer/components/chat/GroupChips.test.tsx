// @vitest-environment happy-dom
import { ALL_GROUP_ID } from '@shared/projectGroups';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroupChips } from './GroupChips';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

let container: HTMLDivElement;
let root: Root;
let measure: () => void;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: () => void) {}
      observe(target: Element) {
        if (target.classList.contains('overflow-x-auto')) measure = this.callback;
      }
      disconnect() {}
    }
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(GroupChips, {
        groups: [],
        selectedId: ALL_GROUP_ID,
        counts: {},
        totalCount: 8,
        ungroupedCount: 0,
        query: '',
        onQueryChange: vi.fn(),
        onSelect: vi.fn(),
        onAddGroup: vi.fn(),
        onEditGroup: vi.fn(),
      })
    )
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const overflowTrigger = () => container.querySelector('button[aria-label="All groups"]');

// happy-dom 不做 flex 布局：模拟按钮出现后，滚动区让出按钮宽度和间距。
function mockLayout(width: number, contentWidth: number, triggerSpace: number) {
  const viewport = container.querySelector('.overflow-x-auto')!;
  const available = viewport.parentElement!;
  const content = viewport.firstElementChild!;
  const viewportWidth = () => width - (overflowTrigger() ? triggerSpace : 0);
  vi.spyOn(available, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width));
  vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, contentWidth));
  vi.spyOn(viewport, 'clientWidth', 'get').mockImplementation(() => Math.round(viewportWidth()));
  vi.spyOn(viewport, 'scrollWidth', 'get').mockImplementation(() =>
    Math.round(Math.max(contentWidth, viewportWidth()))
  );
  return {
    resize: async (newWidth = width) => {
      width = newWidth;
      await act(async () => measure());
    },
  };
}

it('缩小字号后，标签略微放不下时连续重测不会闪动', async () => {
  const { resize } = mockLayout(236.5, 239, 24);
  await resize();
  const trigger = overflowTrigger();
  expect(trigger).not.toBeNull();
  for (let frame = 0; frame < 3; frame++) {
    await resize();
    expect(overflowTrigger()).toBe(trigger);
  }
});

it('放大字号后，按钮缩窄了滚动区也不妨碍在刚好放得下时收起', async () => {
  const { resize } = mockLayout(232, 239.5, 36);
  await resize();
  expect(overflowTrigger()).not.toBeNull();

  await resize(239.5);
  expect(overflowTrigger()).toBeNull();
});
