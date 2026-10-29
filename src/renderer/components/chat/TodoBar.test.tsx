import type { TodoItem } from '@shared/types/agent';
import { parseHTML } from 'linkedom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TodoList } from './TodoBar';

vi.mock('@/stores/sessions', () => ({ useSessionsStore: vi.fn() }));
vi.mock('@/stores/settings', () => ({ useSettingsStore: vi.fn() }));

function renderList(todos: TodoItem[]) {
  const html = renderToStaticMarkup(createElement(TodoList, { todos }));
  return parseHTML(html).document.querySelectorAll('li > span');
}

describe('TodoList 完成状态的可见性', () => {
  it('完成项使用文字同色且随字号缩放的加粗删除线，不再使用浅边框色', () => {
    const [completed] = renderList([
      { content: '核对个人仓库、发布方式和现有展示素材', status: 'completed' },
    ]);

    expect(completed?.textContent).toBe('核对个人仓库、发布方式和现有展示素材');
    expect(completed?.classList.contains('text-muted-foreground')).toBe(true);
    expect(completed?.classList.contains('line-through')).toBe(true);
    expect(completed?.classList.contains('decoration-current')).toBe(true);
    expect(completed?.classList.contains('decoration-[0.12em]')).toBe(true);
    expect(completed?.classList.contains('decoration-border')).toBe(false);
  });

  it('进行中和未开始项保留原有文字层级，不带删除线', () => {
    const [active, pending] = renderList([
      { content: '重写中英文 README', status: 'in_progress' },
      { content: '检查文档链接', status: 'pending' },
    ]);

    expect(active?.classList.contains('font-medium')).toBe(true);
    expect(pending?.classList.contains('text-muted-foreground')).toBe(true);
    expect(active?.classList.contains('line-through')).toBe(false);
    expect(pending?.classList.contains('line-through')).toBe(false);
  });
});
