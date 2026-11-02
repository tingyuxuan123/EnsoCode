import { describe, expect, it } from 'vitest';
import { designToolSettings } from './settings';

describe('design tool settings', () => {
  it('is opt-out, preserves unrelated disabled defaults and forces design off over project overrides', () => {
    expect(designToolSettings(undefined)).toBeUndefined();
    const state = { designEnabled: true, disabledBuiltinTools: ['browser'] };
    expect(designToolSettings(state)).toBe(state);
    const off = designToolSettings({
      designEnabled: false,
      projects: [{ id: 'override', disabledBuiltinTools: [] }, { id: 'inherit' }, null],
    });
    expect(off?.disabledBuiltinTools).toEqual(['memory', 'computer', 'code_search', 'design']);
    expect(off?.projects).toEqual([
      { id: 'override', disabledBuiltinTools: ['design'] },
      { id: 'inherit' },
      null,
    ]);
  });
});
