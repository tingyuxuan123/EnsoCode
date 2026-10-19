import { describe, expect, it } from 'vitest';
import {
  ACCENT_COLORS,
  DEFAULT_ACCENT_COLOR,
  parseAccentColor,
  resolveAccentColor,
} from './accentColor';

describe('accentColor', () => {
  it('默认值是靛蓝，且在合法取值里', () => {
    expect(DEFAULT_ACCENT_COLOR).toBe('indigo');
    expect(ACCENT_COLORS).toContain(DEFAULT_ACCENT_COLOR);
  });

  it('接受全部预设取值', () => {
    for (const accent of ACCENT_COLORS) expect(parseAccentColor(accent)).toBe(accent);
  });

  it('非法值 parse 返回 null，resolve 落回默认值', () => {
    for (const bad of ['neon', '', 'VIOLET', null, undefined, 1, {}]) {
      expect(parseAccentColor(bad)).toBeNull();
      expect(resolveAccentColor(bad)).toBe(DEFAULT_ACCENT_COLOR);
    }
  });
});
