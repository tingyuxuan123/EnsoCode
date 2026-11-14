import { describe, expect, it } from 'vitest';
import {
  PLUGIN_INSPECT_LIMIT,
  type PluginInspectEntry,
  pageInspectScript,
  parseInspectEntries,
} from './inspection';

interface FakeNode {
  tagName?: string;
  nodeType?: number;
  innerText?: string;
  value?: string;
  attrs?: Record<string, string>;
  rect?: { x: number; y: number; width: number; height: number };
  style?: { display?: string; visibility?: string };
  visible?: boolean;
}

const makeNode = (node: FakeNode) => {
  const element: Record<string, unknown> = {
    nodeType: node.nodeType ?? 1,
    tagName: (node.tagName ?? 'div').toUpperCase(),
    innerText: node.innerText ?? '',
    getAttribute: (name: string) => node.attrs?.[name.toLowerCase()] ?? null,
    getBoundingClientRect: () => node.rect ?? { x: 0, y: 0, width: 0, height: 0 },
    checkVisibility: () => node.visible !== false,
  };
  if (node.value !== undefined) element.value = node.value;
  Object.defineProperty(element, '__style', { value: node.style ?? {} });
  return element;
};

const runInspect = (selector: string, nodes: FakeNode[]): unknown => {
  const document = { querySelectorAll: () => nodes.map(makeNode) };
  const window = { getComputedStyle: (node: { __style?: unknown }) => node.__style ?? {} };
  return new Function('document', 'window', `return ${pageInspectScript(selector)}`)(
    document,
    window
  );
};

describe('plugin browser inspection script', () => {
  it('只投影 tag / text / value / ref / rect', () => {
    expect(
      runInspect('#list li', [
        {
          tagName: 'li',
          innerText: 'First row',
          attrs: { 'data-enso-ref': 'row-1' },
          rect: { x: 10, y: 20, width: 100, height: 24 },
        },
      ])
    ).toEqual([
      {
        tag: 'li',
        text: 'First row',
        ref: 'row-1',
        rect: { x: 10, y: 20, width: 100, height: 24 },
      },
    ]);
  });

  it('不返回脚本、样式、密码/隐藏/文件输入与不可见元素', () => {
    expect(
      runInspect('*', [
        { tagName: 'script', innerText: 'window.token = 1' },
        { tagName: 'style', innerText: 'body{color:red}' },
        { tagName: 'input', attrs: { type: 'password' }, value: 'hunter2' },
        { tagName: 'input', attrs: { type: 'hidden' }, value: 'csrf' },
        { tagName: 'input', attrs: { type: 'file' } },
        { tagName: 'div', innerText: 'gone', style: { display: 'none' } },
        { tagName: 'div', innerText: 'hidden', style: { visibility: 'hidden' } },
        { tagName: 'div', innerText: 'collapsed', style: { visibility: 'collapse' } },
        { tagName: 'div', innerText: 'invisible', visible: false },
        { tagName: 'div', innerText: 'kept' },
      ])
    ).toEqual([{ tag: 'div', text: 'kept', rect: { x: 0, y: 0, width: 0, height: 0 } }]);
  });

  it('最多返回 32 项', () => {
    const nodes = Array.from({ length: PLUGIN_INSPECT_LIMIT + 5 }, (_, i) => ({
      tagName: 'span',
      innerText: `row ${i}`,
    }));
    expect(runInspect('span', nodes)).toHaveLength(PLUGIN_INSPECT_LIMIT);
  });

  it('表单字段始终带 value：空串与纯空格都要原样返回', () => {
    const rect = { x: 0, y: 0, width: 4, height: 5 };
    expect(
      runInspect('*', [
        { tagName: 'input', value: '', rect },
        { tagName: 'textarea', value: '   ', rect },
        { tagName: 'select', rect },
      ])
    ).toEqual([
      { tag: 'input', text: '', value: '', rect },
      { tag: 'textarea', text: '', value: '   ', rect },
      { tag: 'select', text: '', value: '', rect },
    ]);
  });

  it('value 超过 8001 时保留 8001 并标记 truncated', () => {
    const [over] = runInspect('*', [{ tagName: 'textarea', value: 'v'.repeat(9000) }]) as {
      value: string;
      truncated?: boolean;
    }[];
    expect(over?.value).toHaveLength(8001);
    expect(over?.truncated).toBe(true);
    const [exact] = runInspect('*', [{ tagName: 'textarea', value: 'v'.repeat(8001) }]) as {
      value: string;
      truncated?: boolean;
    }[];
    expect(exact?.value).toHaveLength(8001);
    expect(exact?.truncated).toBeUndefined();
  });

  it('选择器只作为字符串字面量传入，坏选择器返回空数组', () => {
    const selector = '"); window.pwned = 1; ("';
    expect(runInspect(selector, [])).toEqual([]);
    expect(pageInspectScript(selector)).toContain(JSON.stringify(selector));
  });
});

const entry = (patch: Partial<PluginInspectEntry> = {}): PluginInspectEntry => ({
  tag: 'div',
  text: 'hello',
  rect: { x: 1, y: 2, width: 3, height: 4 },
  ...patch,
});

describe('parseInspectEntries', () => {
  it('非数组结果视为异常', () => {
    for (const raw of [undefined, null, 'x', {}, 1]) expect(parseInspectEntries(raw)).toBeNull();
  });

  it('丢弃未知字段、危险标签与坏形状', () => {
    expect(
      parseInspectEntries([
        { ...entry(), html: '<img onerror=alert(1)>', cookies: 'a=b', storage: '{}' },
        entry({ tag: 'script' }),
        entry({ tag: 'style' }),
        entry({ tag: '' }),
        { ...entry(), rect: { x: 'NaN', y: 0, width: 1, height: 1 } },
        null,
      ])
    ).toEqual([entry()]);
  });

  it('ref 只接受安全字符，text 仍按 400 截断', () => {
    const parsed = parseInspectEntries([
      { ...entry(), ref: 'row-1' },
      { ...entry(), ref: '"><script>' },
      { ...entry(), text: 't'.repeat(1000) },
    ]);
    expect(parsed?.map((item) => item.ref)).toEqual(['row-1', undefined, undefined]);
    expect(parsed?.[2]?.text).toHaveLength(400);
  });

  it('最多 32 项', () => {
    const raw = Array.from({ length: PLUGIN_INSPECT_LIMIT + 3 }, () => entry());
    expect(parseInspectEntries(raw)).toHaveLength(PLUGIN_INSPECT_LIMIT);
  });

  it('表单字段空 value 必须保留，非表单标签一律丢弃 value', () => {
    const rect = { x: 0, y: 0, width: 2, height: 2 };
    expect(
      parseInspectEntries([
        { tag: 'input', text: '', value: '', rect },
        { tag: 'textarea', text: '', value: '   ', rect },
        { tag: 'select', text: '', rect },
        { tag: 'div', text: 'x', value: 'leak', rect },
      ])
    ).toEqual([
      { tag: 'input', text: '', value: '', rect },
      { tag: 'textarea', text: '', value: '   ', rect },
      { tag: 'select', text: '', value: '', rect },
      { tag: 'div', text: 'x', rect },
    ]);
  });

  it('value 上限 8001，超出显式 truncated 而不是静默截断', () => {
    const rect = { x: 0, y: 0, width: 1, height: 1 };
    const [over] =
      parseInspectEntries([{ tag: 'textarea', text: '', value: 'v'.repeat(9000), rect }]) ?? [];
    expect(over?.value).toHaveLength(8001);
    expect(over?.truncated).toBe(true);
    const [exact] =
      parseInspectEntries([{ tag: 'textarea', text: '', value: 'v'.repeat(8001), rect }]) ?? [];
    expect(exact?.value).toHaveLength(8001);
    expect(exact?.truncated).toBeUndefined();
    const [flagged] =
      parseInspectEntries([{ tag: 'input', text: '', value: 'x', truncated: true, rect }]) ?? [];
    expect(flagged?.truncated).toBe(true);
  });
});
