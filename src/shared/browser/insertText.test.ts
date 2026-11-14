import { describe, expect, it } from 'vitest';
import {
  INSERT_TEXT_MAX_BYTES,
  pageActiveElementCheckScript,
  parseActiveElementCheck,
  utf8Length,
} from './insertText';

interface FakeElement {
  tagName?: string;
  type?: string;
  readOnly?: boolean;
  disabled?: boolean;
  contentEditable?: boolean;
  rect?: { width: number; height: number };
  style?: { display?: string; visibility?: string; opacity?: string };
}

const element = (patch: FakeElement = {}): Record<string, unknown> => {
  const el: Record<string, unknown> = {
    tagName: (patch.tagName ?? 'input').toUpperCase(),
    isContentEditable: patch.contentEditable === true,
    getBoundingClientRect: () => ({
      x: 0,
      y: 0,
      width: 120,
      height: 24,
      ...patch.rect,
    }),
  };
  if (patch.type !== undefined) el.type = patch.type;
  if (patch.readOnly !== undefined) el.readOnly = patch.readOnly;
  if (patch.disabled !== undefined) el.disabled = patch.disabled;
  if (patch.style) el.__style = patch.style;
  return el;
};

const runCheck = (active: unknown): unknown => {
  const document = { activeElement: active, body: {}, documentElement: {} };
  const window = {
    getComputedStyle: (el: { __style?: unknown }) => el.__style ?? {},
  };
  return new Function('document', 'window', `return ${pageActiveElementCheckScript()}`)(
    document,
    window
  );
};

const reasonOf = (active: unknown): string => {
  const result = runCheck(active) as { ok: boolean; reason?: string };
  expect(result.ok).toBe(false);
  return String(result.reason);
};

describe('insert_text 的 activeElement 固定校验脚本', () => {
  it('只放行 input / textarea / contenteditable，且不自动 focus 或选择', () => {
    expect(runCheck(element())).toEqual({ ok: true });
    expect(runCheck(element({ tagName: 'textarea' }))).toEqual({ ok: true });
    expect(runCheck(element({ tagName: 'div', contentEditable: true }))).toEqual({ ok: true });
    // 真实 WPS 的 F2 输入代理 opacity:0 但仍接收键盘输入，必须放行
    expect(
      runCheck(
        element({
          tagName: 'textarea',
          style: { display: 'block', visibility: 'visible', opacity: '0' },
        })
      )
    ).toEqual({ ok: true });
  });

  it('没有焦点或焦点是 body/html 时拒绝', () => {
    const document: Record<string, unknown> = {
      body: {},
      documentElement: {},
      activeElement: null,
    };
    const window = { getComputedStyle: () => ({}) };
    const run = () =>
      new Function('document', 'window', `return ${pageActiveElementCheckScript()}`)(
        document,
        window
      );
    expect(run()).toEqual({ ok: false, reason: 'none' });
    document.activeElement = document.body;
    expect(run()).toEqual({ ok: false, reason: 'none' });
    document.activeElement = document.documentElement;
    expect(run()).toEqual({ ok: false, reason: 'none' });
  });

  it('普通元素、password / hidden / file、只读与禁用都拒绝', () => {
    expect(reasonOf(element({ tagName: 'div' }))).toBe('not-editable');
    expect(reasonOf(element({ tagName: 'span' }))).toBe('not-editable');
    expect(runCheck(element({ tagName: 'span', contentEditable: true }))).toEqual({ ok: true });
    expect(reasonOf(element({ type: 'password' }))).toBe('password');
    expect(reasonOf(element({ type: 'hidden' }))).toBe('hidden');
    expect(reasonOf(element({ type: 'file' }))).toBe('file');
    expect(reasonOf(element({ readOnly: true }))).toBe('readonly');
    expect(reasonOf(element({ tagName: 'textarea', disabled: true }))).toBe('disabled');
  });

  it('零尺寸与 display:none / visibility:hidden|collapse 都按不可见拒绝', () => {
    expect(reasonOf(element({ rect: { width: 0, height: 24 } }))).toBe('invisible');
    expect(reasonOf(element({ rect: { width: 120, height: 0 } }))).toBe('invisible');
    for (const style of [{ display: 'none' }, { visibility: 'hidden' }, { visibility: 'collapse' }])
      expect(reasonOf(element({ style }))).toBe('invisible');
  });

  it('把拒绝原因投影成明确错误，异常结果直接报错', () => {
    expect(parseActiveElementCheck({ ok: true })).toEqual({ ok: true });
    expect(parseActiveElementCheck({ ok: false, reason: 'password' })).toMatchObject({
      ok: false,
      reason: 'password',
      message: expect.stringMatching(/password/i),
    });
    // 未知原因不回显给插件，按不可编辑处理
    expect(parseActiveElementCheck({ ok: false, reason: '<script>' })).toMatchObject({
      ok: false,
      reason: 'not-editable',
    });
    for (const raw of [undefined, null, 'ok', {}, { ok: 'yes' }])
      expect(() => parseActiveElementCheck(raw)).toThrow(/unexpected/i);
  });

  it('32KB 上限按 UTF-8 字节计算，边界内放行', () => {
    expect(INSERT_TEXT_MAX_BYTES).toBe(32 * 1024);
    expect(utf8Length('a'.repeat(INSERT_TEXT_MAX_BYTES))).toBe(INSERT_TEXT_MAX_BYTES);
    expect(utf8Length('需')).toBe(3);
  });
});
