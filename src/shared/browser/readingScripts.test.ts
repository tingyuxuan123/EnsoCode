import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { pageReadScript } from './readingScripts';

const read = (scope: 'viewport' | 'document', html: string) => {
  const { document, window } = parseHTML(`<html><body>${html}</body></html>`);
  for (const el of document.querySelectorAll('*')) {
    Object.defineProperty(el, 'getBoundingClientRect', { value: () => ({ x: 0, y: el.id === 'below' ? 900 : 0, top: el.id === 'below' ? 900 : 0, bottom: el.id === 'below' ? 920 : 20, left: 0, right: 100, width: 100, height: 20 }) });
  }
  return new Function('document', 'window', 'innerWidth', 'innerHeight', 'getComputedStyle', `return ${pageReadScript({ scope }, 's1')}`)(document, window, 800, 600, () => ({ display: 'block', visibility: 'visible', opacity: '1' }));
};

describe('页面已加载 DOM 读取', () => {
  it('document 包含屏外正文但 viewport 不包含，password 当前值不读取', () => {
    const html = '<p>Visible</p><p id="below">Offscreen</p><input type="password" value="secret"><button>Save</button>';
    expect(read('viewport', html).text).not.toContain('Offscreen');
    const full = read('document', html);
    expect(full.text).toContain('Offscreen');
    expect(JSON.stringify(full)).not.toContain('secret');
    expect(full.entries).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'button', name: 'Save', ref: 'es1_2' })]));
  });
  it('开放 shadow root 里的文本与控件也有引用', () => {
    const { document, window } = parseHTML('<html><body><main></main></body></html>');
    const root = document.querySelector('main')?.attachShadow({ mode: 'open' });
    if (!root) throw new Error('missing shadow');
    root.innerHTML = '<button>Shadow</button>';
    for (const el of [document.querySelector('main'), root.querySelector('button')]) {
      if (el) Object.defineProperty(el, 'getBoundingClientRect', { value: () => ({ width: 10, height: 10, top: 0, bottom: 10, left: 0, right: 10 }) });
    }
    const result = new Function('document', 'window', 'innerWidth', 'innerHeight', 'getComputedStyle', `return ${pageReadScript({ scope: 'document' }, 's2')}`)(document, window, 800, 600, () => ({}));
    expect(result.text).toContain('Shadow');
    expect(result.entries).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Shadow' })]));
  });
});
