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

it('accepts only real model choices for a model field', () => {
  expect(coerceConfigValue({ type: 'model' }, 'session')).toEqual({ ok: true, value: 'session' });
  expect(coerceConfigValue({ type: 'model' }, 'title')).toEqual({ ok: true, value: 'title' });
  expect(coerceConfigValue({ type: 'model' }, 'p1::a/b:c')).toEqual({
    ok: true,
    value: 'p1::a/b:c',
  });
  for (const input of ['', 'gpt', 'session ', 'p1::', '::a/b'])
    expect(coerceConfigValue({ type: 'model' }, input).ok, input).toBe(false);
  // 清空是合法值：回落清单默认
  expect(coerceConfigValue({ type: 'model' }, null)).toEqual({ ok: true, value: null });
});
