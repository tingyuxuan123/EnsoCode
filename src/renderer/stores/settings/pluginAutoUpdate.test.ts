import { expect, it } from 'vitest';
import { mergeSettingsState } from './migrate';

it('defaults plugin automatic updates on and preserves only an explicit false', () => {
  const current = {
    editMode: 'apply_patch' as const,
    accentColor: 'ocean' as const,
    pluginAutoUpdate: true,
  };
  for (const value of [undefined, null, 0, 'false', {}, true, false]) {
    expect(mergeSettingsState({ pluginAutoUpdate: value }, current).pluginAutoUpdate).toBe(
      value !== false
    );
  }
  expect(mergeSettingsState({}, current).pluginAutoUpdate).toBe(true);
});
