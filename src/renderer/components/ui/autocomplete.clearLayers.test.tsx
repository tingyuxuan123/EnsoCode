// 清除动画把输入框文字交给 .t-clear-mirror 独占；两层同时可见时同一段文字会叠印。
// 这里在真实 DOM（linkedom + react-dom/client）里校验两件事：
// 1. 样式表里“隐藏输入框字形”的规则必须命中真实渲染出来的 input；
// 2. 值被程序改写（选项目、点浏览）时镜像层文本必须跟着同步，避免显示旧路径。
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Autocomplete, AutocompleteInput } from './autocomplete';

const GLOBALS_CSS = new URL('../../styles/globals.css', import.meta.url);

function bootstrapDom() {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const globals = globalThis as unknown as Record<string, unknown>;
  for (const name of [
    'Node',
    'Element',
    'HTMLElement',
    'SVGElement',
    'Event',
    'CustomEvent',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'matchMedia',
    'ResizeObserver',
    'MutationObserver',
    'IntersectionObserver',
  ]) {
    const value = (window as unknown as Record<string, unknown>)[name];
    if (value !== undefined) globals[name] = value;
  }
  if (typeof window.getComputedStyle === 'function') {
    globals.getComputedStyle = window.getComputedStyle.bind(window);
  }
  globals.window = window;
  globals.document = window.document;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  return window;
}

async function mountAutocomplete(value: string) {
  const window = bootstrapDom();
  const container = window.document.getElementById('root') as unknown as Element;
  const root: Root = createRoot(container);
  const render = (next: string) =>
    act(async () => {
      root.render(
        createElement(
          Autocomplete,
          { value: next },
          createElement(AutocompleteInput, { showClear: true, placeholder: 'path' })
        )
      );
    });
  await render(value);
  const wrapper = container.querySelector('.t-clear') as unknown as HTMLElement;
  const input = wrapper.querySelector('input') as unknown as HTMLInputElement;
  const mirror = wrapper.querySelector('.t-clear-mirror') as unknown as HTMLElement;
  return { render, wrapper, input, mirror };
}

/** globals.css 里所有“把输入框字形变透明”的选择器（清除动画这套双向层） */
function glyphHidingSelectors(): string[] {
  const css = readFileSync(GLOBALS_CSS, 'utf8');
  const selectors: string[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!rule[2].includes('-webkit-text-fill-color: transparent')) continue;
    if (!/t-clear|autocomplete-clear-dissolve/.test(rule[1])) continue;
    selectors.push(
      ...rule[1]
        .split(',')
        .map((selector) => selector.trim())
        .filter(Boolean)
    );
  }
  return selectors;
}

describe('autocomplete clear layers', () => {
  it('hides the value input glyphs whenever the mirror renders the same text', async () => {
    const { wrapper, input, mirror } = await mountAutocomplete('/Users/yfdl/work/xc-app-new');

    expect(wrapper.classList.contains('has-value')).toBe(true);
    expect(mirror.textContent).toBe('/Users/yfdl/work/xc-app-new');

    const selectors = glyphHidingSelectors();
    expect(selectors.length).toBeGreaterThan(0);

    // is-clearing 由清除动画期间临时加上，规则同样要命中
    wrapper.classList.add('is-clearing');
    const matched = selectors.filter((selector) => {
      try {
        return input.matches(selector);
      } catch {
        return false;
      }
    });
    wrapper.classList.remove('is-clearing');

    expect(
      matched,
      `没有透明规则命中承载取值的 input，镜像层会和输入框文字叠印。选择器：${selectors.join(' | ')}`
    ).not.toHaveLength(0);
  });

  it('keeps the mirror text in sync when the value changes without typing', async () => {
    const { render, input, mirror } = await mountAutocomplete('/Users/yfdl/work/old');

    await render('/Users/yfdl/work/xc-app-new');

    expect(input.value).toBe('/Users/yfdl/work/xc-app-new');
    expect(mirror.textContent).toBe('/Users/yfdl/work/xc-app-new');
  });
});
