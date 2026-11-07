import { parseHTML } from 'linkedom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeBlock } from './CodeBlock';

vi.mock('./snippetHighlighter', () => ({
  codeToHtml: vi.fn(async () => '<pre><code><span>highlighted</span></code></pre>'),
}));
vi.mock('./CopyButton', () => ({ CopyButton: () => <button type="button">copy</button> }));
let container: HTMLElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  const { window } = parseHTML('<html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', window.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('代码块排版', () => {
  it('流式纯文本与完成高亮共用字号字重，复制不受影响', async () => {
    await act(async () => root.render(<CodeBlock code="const x = 1" streaming />));
    const streamingStyle = container.querySelector('[data-chat-code]')?.getAttribute('style');
    expect(streamingStyle).toContain('--chat-code-block-scale');
    expect(streamingStyle).toContain('--chat-code-block-weight');
    expect(container.querySelector('button')).toBeNull();
    await act(async () => root.render(<CodeBlock code="const x = 1" />));
    expect(container.textContent).toContain('highlighted');
    expect(container.querySelector('[data-chat-code]')?.getAttribute('style')).toBe(streamingStyle);
    expect(container.querySelector('button')).not.toBeNull();
  });
});
