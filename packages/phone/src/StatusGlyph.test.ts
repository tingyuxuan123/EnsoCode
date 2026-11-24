import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { rowTitleClass, rowTone, StatusGlyph, waitingRowClass } from './StatusGlyph';

describe('会话行的状态符号', () => {
  it('等你的优先级最高：有挂起的提问/审批就是等你，即便还在跑', () => {
    expect(rowTone({ status: 'running', pendingAskCount: 1 })).toBe('waiting');
    expect(rowTone({ status: 'idle', pendingApprovalCount: 2 })).toBe('waiting');
  });

  it('其次出错，再其次运行中；完成与空闲不画符号', () => {
    expect(rowTone({ status: 'failed' })).toBe('error');
    expect(rowTone({ status: 'running' })).toBe('running');
    expect(rowTone({ status: 'idle' })).toBe('idle');
    expect(rowTone({ status: 'idle', unread: true })).toBe('done');
  });

  it('待办计数为 0 不算等你', () => {
    expect(rowTone({ status: 'idle', pendingAskCount: 0, pendingApprovalCount: 0 })).toBe('idle');
  });

  it('完成与空闲不渲染任何符号，只有等你/运行/出错才有', () => {
    const html = (tone: Parameters<typeof StatusGlyph>[0]['tone']) =>
      renderToStaticMarkup(createElement(StatusGlyph, { tone }));
    expect(html('idle')).toBe('');
    expect(html('done')).toBe('');
    expect(html('running')).toContain('运行中');
    expect(html('waiting')).toContain('等你处理');
    expect(html('error')).toContain('出错');
  });

  it('等你的那条整行黄底、标题加粗', () => {
    expect(waitingRowClass).toContain('--yellow');
    expect(rowTitleClass('waiting')).toContain('font-semibold');
    expect(rowTitleClass('idle')).toContain('font-medium');
  });
});
