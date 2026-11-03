import { expect, it, vi } from 'vitest';
import { dispatchDesignShortcut } from './shortcuts';

it('handles focused canvas bindings but never editable, composing, or reserved host keys', () => {
  const run = vi.fn();
  const scopes = [{ id: 'note', kind: 'surface' as const, bindings: [{ key: 'c', run }] }];
  expect(
    dispatchDesignShortcut(new KeyboardEvent('keydown', { key: 'c' }), scopes, false, [])
  ).toBe(true);
  expect(dispatchDesignShortcut(new KeyboardEvent('keydown', { key: 'c' }), scopes, true, [])).toBe(
    false
  );
  expect(
    dispatchDesignShortcut(
      new KeyboardEvent('keydown', { key: 'c', isComposing: true }),
      scopes,
      false,
      []
    )
  ).toBe(false);
  expect(
    dispatchDesignShortcut(new KeyboardEvent('keydown', { key: 'c' }), scopes, false, ['c'])
  ).toBe(false);
  expect(run).toHaveBeenCalledTimes(1);
});
