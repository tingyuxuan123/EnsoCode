import { describe, expect, it } from 'vitest';
import {
  type AxTreeNode,
  axFingerprint,
  axFingerprintMatches,
  formatAxTree,
  formatAxTreeDiff,
} from './axTree';

describe('AX ref 身份字段', () => {
  const node: AxTreeNode = { ref: 'e1', role: 'AXButton', title: '保存', description: '文档操作' };

  it.each(['role', 'title', 'description'] as const)(
    '%s 改变（包括原生空值）不是同一身份',
    (key) => {
      const observed = axFingerprint(node);
      expect(axFingerprintMatches(observed, { ...node, [key]: '另一控件' })).toBe(false);
      if (key !== 'role') {
        expect(axFingerprintMatches(observed, { ...node, [key]: '' })).toBe(false);
      }
    }
  );

  it('空字符串和缺省统一，但 value/focus/enabled/位置不参与身份', () => {
    const observed = axFingerprint({ ref: 'e1', role: 'AXTextField', title: '' });
    expect(
      axFingerprintMatches(observed, {
        ref: 'e1',
        role: 'AXTextField',
        value: '新内容',
        focused: true,
        enabled: false,
        bounds: { x: 1, y: 2, width: 3, height: 4 },
      })
    ).toBe(true);
  });
});

describe('formatAxTree', () => {
  it('输出带 [ref=eN] 的文本树', () => {
    const text = formatAxTree([
      {
        ref: 'e1',
        role: 'window',
        title: 'Settings',
        children: [{ ref: 'e2', role: 'button', title: 'Save', focused: true, actions: ['press'] }],
      },
    ]);
    expect(text).toContain('window [ref=e1] title="Settings"');
    expect(text).toContain('button [ref=e2] title="Save" focused actions=press');
  });

  it('空 AXGroup 包装层压掉，子按钮提到上一层', () => {
    const text = formatAxTree([
      {
        ref: 'e1',
        role: 'AXWindow',
        title: '外观',
        children: [
          {
            ref: 'e2',
            role: 'AXGroup',
            children: [{ ref: 'e3', role: 'AXRadioButton', title: '浅色' }],
          },
        ],
      },
    ]);
    expect(text).not.toContain('AXGroup');
    expect(text).toContain('AXRadioButton [ref=e3] title="浅色"');
  });
});

describe('formatAxTreeDiff', () => {
  it('只改 ref 视为 unchanged', () => {
    const a = 'button [ref=e1] title="Save"';
    const b = 'button [ref=e9] title="Save"';
    expect(formatAxTreeDiff(a, b)).toBe('(ax unchanged)');
  });

  it('新增行带当前 ref', () => {
    const prev = 'window [ref=e1] title="Settings"\n  button [ref=e2] title="Save"';
    const curr =
      'window [ref=e3] title="Settings"\n  button [ref=e4] title="Save"\n  button [ref=e5] title="Cancel"';
    const diff = formatAxTreeDiff(prev, curr);
    expect(diff).toContain('+');
    expect(diff).toContain('[ref=e5]');
    expect(diff).toContain('Cancel');
    expect(diff).not.toContain('Save');
  });
});
