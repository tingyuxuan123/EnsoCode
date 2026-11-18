import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { findActionTarget } from './actions';
import { pageReadScript } from './readingScripts';

const read = (scope: 'viewport' | 'document', html: string) => {
  const { document, window } = parseHTML(`<html><body>${html}</body></html>`);
  for (const el of document.querySelectorAll('*')) {
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({
        x: 0,
        y: el.id === 'below' ? 900 : 0,
        top: el.id === 'below' ? 900 : 0,
        bottom: el.id === 'below' ? 920 : 20,
        left: 0,
        right: 100,
        width: 100,
        height: 20,
      }),
    });
  }
  return new Function(
    'document',
    'window',
    'innerWidth',
    'innerHeight',
    'getComputedStyle',
    `return ${pageReadScript({ scope }, 's1')}`
  )(document, window, 800, 600, () => ({ display: 'block', visibility: 'visible', opacity: '1' }));
};

describe('页面已加载 DOM 读取', () => {
  it('批量操作按提交按钮 value 和 aria-labelledby 定位，与快照一致', () => {
    const result = read(
      'viewport',
      '<span id="login-label">普通登录</span><input type="submit" value="登录"><button aria-labelledby="login-label"></button>'
    );
    expect(findActionTarget(result.entries, { target: '登录', role: 'button' })).toBe('es1_1');
    expect(findActionTarget(result.entries, { target: '普通登录', role: 'button' })).toBe('es1_2');
  });

  it('按输入框 name 定位，且不会把密码 value 当成控件名称', () => {
    const result = read(
      'viewport',
      '<input name="username"><input type="password" name="password" value="DO_NOT_LEAK">'
    );
    expect(findActionTarget(result.entries, { target: 'username' })).toBe('es1_1');
    expect(findActionTarget(result.entries, { target: 'password' })).toBe('es1_2');
    expect(JSON.stringify(result)).not.toContain('DO_NOT_LEAK');
  });

  it('action feedback keeps refs only on the same surviving DOM node; cloned refs are not reused', () => {
    const { document, window } = parseHTML(
      '<html><body><button aria-label="Save">Save</button><input type="password" value="DO_NOT_LEAK"></body></html>'
    );
    const run = (id: string, preserveRefs: string[] = []) => {
      for (const el of document.querySelectorAll('*'))
        Object.defineProperty(el, 'getBoundingClientRect', {
          configurable: true,
          value: () => ({
            x: 0,
            y: 0,
            width: 100,
            height: 20,
            top: 0,
            bottom: 20,
            left: 0,
            right: 100,
          }),
        });
      return new Function(
        'document',
        'window',
        'innerWidth',
        'innerHeight',
        'getComputedStyle',
        `return ${pageReadScript({ scope: 'viewport' }, id, { compact: true, preserveRefs })}`
      )(document, window, 800, 600, () => ({}));
    };
    const first = run('s1');
    const refs = first.entries.map((e: { ref: string }) => e.ref);
    expect(run('s2', refs).entries[0].ref).toBe(refs[0]);
    const original = document.querySelector('button')!;
    original.replaceWith(original.cloneNode(true));
    const after = run('s3', refs);
    expect(after.entries[0].ref).not.toBe(refs[0]);
    expect(JSON.stringify(after)).not.toContain('DO_NOT_LEAK');
    expect(run('s4').entries[0].ref).not.toBe(after.entries[0].ref);
  });
  it('document 包含屏外正文但 viewport 不包含，password 当前值不读取', () => {
    const html =
      '<p>Visible</p><p id="below">Offscreen</p><input type="password" value="secret"><button>Save</button>';
    expect(read('viewport', html).text).not.toContain('Offscreen');
    const full = read('document', html);
    expect(full.text).toContain('Offscreen');
    expect(JSON.stringify(full)).not.toContain('secret');
    expect(full.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'button', name: 'Save', ref: 'es1_2' }),
      ])
    );
  });
  it('只读正文不覆盖网页内已有的控件引用或为新控件添加引用', () => {
    const { document, window } = parseHTML(
      '<html><body><textarea data-enso-ref="es1_1">Draft</textarea><button>Send</button><p>Reply</p></body></html>'
    );
    for (const el of document.querySelectorAll('*')) {
      Object.defineProperty(el, 'getBoundingClientRect', {
        value: () => ({ width: 100, height: 20 }),
      });
    }
    const result = new Function(
      'document',
      'window',
      'getComputedStyle',
      `return ${pageReadScript({ scope: 'document' }, 's2', { collectElements: false })}`
    )(document, window, () => ({}));
    expect(result.text).toContain('Reply');
    expect(result.text).not.toContain('Draft');
    expect(result.entries).toEqual([]);
    expect(document.querySelector('textarea')?.getAttribute('data-enso-ref')).toBe('es1_1');
    expect(document.querySelector('button')?.hasAttribute('data-enso-ref')).toBe(false);
  });
  it('开放 shadow root 里的文本与控件也有引用', () => {
    const { document, window } = parseHTML('<html><body><main></main></body></html>');
    const root = document.querySelector('main')?.attachShadow({ mode: 'open' });
    if (!root) throw new Error('missing shadow');
    root.innerHTML = '<button>Shadow</button>';
    for (const el of [document.querySelector('main'), root.querySelector('button')]) {
      if (el)
        Object.defineProperty(el, 'getBoundingClientRect', {
          value: () => ({ width: 10, height: 10, top: 0, bottom: 10, left: 0, right: 10 }),
        });
    }
    const result = new Function(
      'document',
      'window',
      'innerWidth',
      'innerHeight',
      'getComputedStyle',
      `return ${pageReadScript({ scope: 'document' }, 's2')}`
    )(document, window, 800, 600, () => ({}));
    expect(result.text).toContain('Shadow');
    expect(result.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Shadow' })])
    );
  });
});
