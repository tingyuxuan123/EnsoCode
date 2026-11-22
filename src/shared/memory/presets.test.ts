import { describe, expect, it } from 'vitest';
import { buildPresetSchemaMarkdown, defaultPresetForSpace, PRESET_TYPES } from './presets';

describe('vault presets', () => {
  it('picks sensible default presets by space kind', () => {
    expect(defaultPresetForSpace('proj:123')).toBe('engineering');
    expect(defaultPresetForSpace('chat:456')).toBe('engineering');
    expect(defaultPresetForSpace('global')).toBe('personal');
    expect(defaultPresetForSpace('bot:789')).toBe('personal');
  });

  it('builds readable schema.md templates covering triggers and types', () => {
    const engZh = buildPresetSchemaMarkdown('engineering', 'zh');
    expect(engZh).toContain('systems');
    expect(engZh).toContain('incidents');
    expect(engZh).toContain('practices');
    expect(engZh).toContain('raw/');
    expect(engZh).toContain('排障收口');

    const personalEn = buildPresetSchemaMarkdown('personal', 'en');
    expect(personalEn).toContain('preferences');
    expect(personalEn).toContain('decisions');

    const minimal = buildPresetSchemaMarkdown('minimal', 'en');
    expect(minimal).toContain('notes');
    expect(PRESET_TYPES.engineering.length).toBeGreaterThan(3);
  });

  it('gives every real vault one status page type with a one-screen budget', () => {
    expect(PRESET_TYPES.engineering).toContain('status');
    expect(PRESET_TYPES.personal).toContain('status');
    expect(PRESET_TYPES.minimal).not.toContain('status');

    const engZh = buildPresetSchemaMarkdown('engineering', 'zh');
    expect(engZh).toContain('status');
    expect(engZh).toContain('60 行');
    expect(buildPresetSchemaMarkdown('engineering', 'en')).toContain('60 lines');
  });
});
