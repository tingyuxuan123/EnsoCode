import { parseHTML } from 'linkedom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserNewTab } from './BrowserNewTab';

const t = (key: string) => key;
vi.mock('@/i18n', () => ({ useI18n: () => ({ t, locale: 'en' }) }));

let root: Root;
let container: HTMLElement;

const classesOf = (element: Element | null | undefined): string[] =>
  (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

beforeEach(async () => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = dom.document.getElementById('root') as unknown as HTMLElement;
  root = createRoot(container);
  await act(async () => root.render(<BrowserNewTab />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('BrowserNewTab layout', () => {
  it('centers the content block horizontally and vertically inside the panel', () => {
    const shell = container.querySelector(':scope > div');
    const block = shell?.querySelector(':scope > div');
    expect(classesOf(block)).toEqual(
      expect.arrayContaining(['mx-auto', 'max-w-md', 'flex-col', 'justify-center'])
    );
    // 收缩到内容宽度，max-w-md 只作为上限；否则文本靠左，视觉上偏左。
    expect(classesOf(block)).toContain('w-fit');
    expect(classesOf(block)).not.toContain('w-full');
    // 内容列整体居中，但行内是左对齐的图标 + 文本两列。
    expect(classesOf(block)).not.toContain('text-center');
    expect(classesOf(block)).not.toContain('items-center');
  });

  it('keeps every capability icon left of a top-aligned title and detail column', () => {
    const rows = Array.from(container.querySelectorAll('h3')).map((heading) => {
      const column = heading.parentElement;
      return { row: column?.parentElement ?? null, column };
    });
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(classesOf(row.row)).toEqual(expect.arrayContaining(['flex', 'items-start', 'gap-3']));
      expect(classesOf(row.row)).not.toContain('flex-col');
      // 图标是行的第一个子元素，文本列是第二个。
      expect(row.row?.children[0]?.tagName.toLowerCase()).toBe('svg');
      expect(row.row?.children[1]).toBe(row.column);
      // 标题和说明都在同一文本列里，说明在标题下方。
      expect(row.column?.querySelector('h3')).not.toBeNull();
      expect(row.column?.querySelector('p')).not.toBeNull();
    }
  });

  it('no longer renders the takeover hint box', () => {
    expect(container.querySelector('div.border-dashed')).toBeNull();
    expect(container.textContent).not.toContain(
      'You can take control at any time. The agent only resumes when you allow it.'
    );
  });
});
