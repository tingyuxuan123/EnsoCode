import { describe, expect, it } from 'vitest';
import { pickToolbarCollapse } from './toolbarCollapse';

// 按收起优先级排列（最不重要的在前）
const items = [
  { full: 70, compact: 30 },
  { full: 100, compact: 30 },
  { full: 70, compact: 30 },
  { full: 60, compact: 30 },
];
const opts = { gap: 4, moreWidth: 28 };

describe('pickToolbarCollapse', () => {
  it('放得下时全部显示文字', () => {
    // 70+100+70+60 + 3*4 = 312
    expect(pickToolbarCollapse(items, 312, opts)).toEqual({ compact: 0, overflow: 0 });
  });

  it('差一点时只收起最不重要的一项', () => {
    // 第一项收起：30+100+70+60+12 = 272
    expect(pickToolbarCollapse(items, 300, opts)).toEqual({ compact: 1, overflow: 0 });
    expect(pickToolbarCollapse(items, 272, opts)).toEqual({ compact: 1, overflow: 0 });
  });

  it('逐个收起，而不是一次全部收起', () => {
    // 前两项收起：30+30+70+60+12 = 202
    expect(pickToolbarCollapse(items, 230, opts)).toEqual({ compact: 2, overflow: 0 });
    // 全部收起：4*30+12 = 132
    expect(pickToolbarCollapse(items, 140, opts)).toEqual({ compact: 4, overflow: 0 });
  });

  it('全是图标仍放不下时，按同一顺序逐个收进「…」', () => {
    // 第一项进菜单：3*30 + 28 + 3*4 = 130
    expect(pickToolbarCollapse(items, 130, opts)).toEqual({ compact: 4, overflow: 1 });
    // 两项进菜单：2*30 + 28 + 2*4 = 96
    expect(pickToolbarCollapse(items, 100, opts)).toEqual({ compact: 4, overflow: 2 });
  });

  it('连「…」都放不下时全部进菜单，只剩「…」', () => {
    expect(pickToolbarCollapse(items, 10, opts)).toEqual({ compact: 4, overflow: 4 });
  });

  it('没有项目时什么都不收', () => {
    expect(pickToolbarCollapse([], 0, opts)).toEqual({ compact: 0, overflow: 0 });
  });

  it('宽度未知（尚未测量）时先全部显示，不抖动', () => {
    expect(pickToolbarCollapse(items, Number.NaN, opts)).toEqual({ compact: 0, overflow: 0 });
  });
});
