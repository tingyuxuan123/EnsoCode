import { describe, expect, it } from 'vitest';
import type { SettingsCategory } from './constants';
import { isCategoryVisible, resolveActiveCategory, visibleCategories } from './settingsCategories';

const cats = [
  { id: 'general' as SettingsCategory },
  { id: 'tools' as SettingsCategory },
  { id: 'usage' as SettingsCategory },
];

const known = cats.map((category) => category.id);

describe('visibleCategories', () => {
  it('never hides pages that do not depend on a tool', () => {
    const ids = visibleCategories(cats, ['browser', 'isolated_sandbox']).map((c) => c.id);
    expect(ids).toEqual(['general', 'tools', 'usage']);
  });

  it('hides the workflows page while the workflow tool is off', () => {
    const withWorkflows = [...cats, { id: 'workflows' as SettingsCategory }];
    const knownWithWorkflows = withWorkflows.map((category) => category.id);
    expect(visibleCategories(withWorkflows, ['workflow']).map((c) => c.id)).not.toContain(
      'workflows'
    );
    expect(visibleCategories(withWorkflows, ['browser']).map((c) => c.id)).toContain('workflows');
    expect(resolveActiveCategory('workflows', ['workflow'], knownWithWorkflows)).toBe('tools');
  });
});

describe('resolveActiveCategory', () => {
  it('falls back to Built-in tools when the active page just got hidden', () => {
    // 落在能把它重新打开的地方，而不是通用页
    expect(resolveActiveCategory('workflows', ['workflow'], [...known, 'workflows'])).toBe('tools');
  });

  it('leaves the active page alone when it is still visible', () => {
    expect(resolveActiveCategory('workflows', [], [...known, 'workflows'])).toBe('workflows');
    expect(resolveActiveCategory('usage', ['workflow'], known)).toBe('usage');
  });
});

describe('已退役分页', () => {
  it('旧进程/热更新送来的不存在分页回落到通用页', () => {
    // 预设页已移除：导航集合里没有它，不能被当成合法选中项
    expect(resolveActiveCategory('presets' as SettingsCategory, [], known)).toBe('general');
  });

  it('仍被工具开关隐藏的已知分页回落到内置工具页', () => {
    expect(resolveActiveCategory('workflows', ['workflow'], [...known, 'workflows'])).toBe('tools');
  });
});

describe('isCategoryVisible', () => {
  it('treats an unrelated disabled tool as irrelevant', () => {
    expect(isCategoryVisible('workflows', ['browser'])).toBe(true);
  });
});
