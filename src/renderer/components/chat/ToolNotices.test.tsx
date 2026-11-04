import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToolNotices } from './ToolNotices';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

describe('ToolNotices', () => {
  it('捎带的提醒默认收起，展开后按顺序给出正文且不带标签', () => {
    const html = renderToStaticMarkup(
      createElement(ToolNotices, {
        notices: [
          { tag: 'background-task-update', text: 'task-1 done' },
          { tag: 'system-reminder', text: 'todo stale' },
        ],
      })
    );
    expect(html).toMatch(/^<details(?![^>]*\bopen\b)/);
    expect(html).toContain('System reminders · 2');
    expect(html.indexOf('task-1 done')).toBeLessThan(html.indexOf('todo stale'));
    expect(html).not.toContain('&lt;system-reminder&gt;');
  });

  it('没有提醒时不渲染', () => {
    expect(renderToStaticMarkup(createElement(ToolNotices, { notices: [] }))).toBe('');
  });
});
