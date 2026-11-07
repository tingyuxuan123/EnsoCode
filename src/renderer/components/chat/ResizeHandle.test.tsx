import { parseHTML } from 'linkedom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ResizeHandle } from './ResizeHandle';

let root: Root;
let onResize: Mock<(deltaX: number) => void>;
let onResizingChange: Mock<(resizing: boolean) => void>;

/** linkedom 没有 MouseEvent，用 Event 补上 clientX，React 的合成事件同样读得到 */
function mouse(type: string, clientX: number): Event {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clientX', { value: clientX });
  return event;
}

function grip(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="resize-grip"]');
}

beforeEach(async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', window.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  onResize = vi.fn();
  onResizingChange = vi.fn();
  root = createRoot(window.document.getElementById('root') as unknown as HTMLElement);
  await act(async () => root.render(createElement(ResizeHandle, { onResize, onResizingChange })));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('ResizeHandle', () => {
  it('把拖动拆成增量交给 onResize，并在松手时收尾', async () => {
    const hit = document.querySelector<HTMLElement>('[data-slot="resize-hit"]');
    await act(async () => {
      hit?.dispatchEvent(mouse('mousedown', 100));
    });
    await act(async () => {
      document.dispatchEvent(mouse('mousemove', 130));
      document.dispatchEvent(mouse('mousemove', 155));
    });
    expect(onResize.mock.calls).toEqual([[30], [25]]);
    expect(onResizingChange.mock.calls).toEqual([[true]]);

    await act(async () => {
      document.dispatchEvent(mouse('mouseup', 155));
    });
    expect(onResizingChange.mock.calls).toEqual([[true], [false]]);

    await act(async () => {
      document.dispatchEvent(mouse('mousemove', 400));
    });
    expect(onResize.mock.calls).toEqual([[30], [25]]);
  });

  it('整段拖动期间锁住列宽光标，松手后还原', async () => {
    const hit = document.querySelector<HTMLElement>('[data-slot="resize-hit"]');
    expect(document.body.style.cursor).toBe('');

    await act(async () => {
      hit?.dispatchEvent(mouse('mousedown', 100));
    });
    // 指针离开 1px 分隔线后本体光标会落回默认值，拖动途中也要一直是横向调整光标
    expect(document.body.style.cursor).toBe('col-resize');

    await act(async () => {
      document.dispatchEvent(mouse('mouseup', 100));
    });
    expect(document.body.style.cursor).toBe('');
  });

  it('把手默认为未激活态，拖动时标记 active', async () => {
    expect(grip()?.getAttribute('data-active')).toBe('false');
    const hit = document.querySelector<HTMLElement>('[data-slot="resize-hit"]');
    await act(async () => {
      hit?.dispatchEvent(mouse('mousedown', 100));
    });
    expect(grip()?.getAttribute('data-active')).toBe('true');
    await act(async () => {
      document.dispatchEvent(mouse('mouseup', 100));
    });
    expect(grip()?.getAttribute('data-active')).toBe('false');
  });
});
