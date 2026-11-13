import { expect, it } from 'vitest';
import { coerceConfigValue } from './configValue';

it('coerces typed config and rejects dirty numeric, enum and range inputs', () => {
  expect(coerceConfigValue({ type: 'boolean' }, 'false')).toEqual({ ok: true, value: false });
  expect(coerceConfigValue({ type: 'number', min: 1, max: 3 }, '2')).toEqual({
    ok: true,
    value: 2,
  });
  for (const input of ['', 'Infinity', '2px', '4'])
    expect(coerceConfigValue({ type: 'number', min: 1, max: 3 }, input).ok).toBe(false);
  expect(coerceConfigValue({ type: 'enum', options: ['a'] }, 'b').ok).toBe(false);
  expect(coerceConfigValue({ type: 'string' }, null)).toEqual({ ok: true, value: null });
});
