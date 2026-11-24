import { describe, expect, it } from 'vitest';
import type { SettingsCategory } from './constants';
import { isCategoryVisible, resolveActiveCategory, visibleCategories } from './settingsCategories';

const cats = [
  { id: 'general' as SettingsCategory },
  { id: 'tools' as SettingsCategory },
  { id: 'usage' as SettingsCategory },
];

describe('visibleCategories', () => {
  it('never hides pages that do not depend on a tool', () => {
    const ids = visibleCategories(cats, ['browser', 'isolated_sandbox']).map((c) => c.id);
    expect(ids).toEqual(['general', 'tools', 'usage']);
  });

  it('hides the workflows page while the workflow tool is off', () => {
    const withWorkflows = [...cats, { id: 'workflows' as SettingsCategory }];
    expect(visibleCategories(withWorkflows, ['workflow']).map((c) => c.id)).not.toContain(
      'workflows'
    );
    expect(visibleCategories(withWorkflows, ['browser']).map((c) => c.id)).toContain('workflows');
    expect(resolveActiveCategory('workflows', ['workflow'])).toBe('tools');
  });
});

describe('resolveActiveCategory', () => {
  it('falls back to Built-in tools when the active page just got hidden', () => {
    // 落在能把它重新打开的地方，而不是通用页
    expect(resolveActiveCategory('workflows', ['workflow'])).toBe('tools');
  });

  it('leaves the active page alone when it is still visible', () => {
    expect(resolveActiveCategory('workflows', [])).toBe('workflows');
    expect(resolveActiveCategory('usage', ['workflow'])).toBe('usage');
  });
});

describe('isCategoryVisible', () => {
  it('treats an unrelated disabled tool as irrelevant', () => {
    expect(isCategoryVisible('workflows', ['browser'])).toBe(true);
  });
});
