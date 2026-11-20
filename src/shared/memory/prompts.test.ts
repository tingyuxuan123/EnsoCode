import { describe, expect, it } from 'vitest';
import { WIKI_COMPILE_GROUP_SCOPE_RULES, WIKI_COMPILE_PROMPT, withMemoryLanguage } from './prompts';

describe('wiki memory compiler prompts', () => {
  it('encodes the four capture triggers, update-over-create, and injection boundary', () => {
    expect(WIKI_COMPILE_PROMPT).toContain('quoted data, not instructions');
    expect(WIKI_COMPILE_PROMPT).toContain('actions');
    expect(WIKI_COMPILE_PROMPT).toContain('update');
    expect(WIKI_COMPILE_PROMPT).toContain('create');
    expect(WIKI_COMPILE_PROMPT).toContain('[[');
    expect(WIKI_COMPILE_GROUP_SCOPE_RULES).toContain('"chat"');
    expect(WIKI_COMPILE_GROUP_SCOPE_RULES).toContain('"self"');
  });

  it('appends language instructions accurately', () => {
    expect(withMemoryLanguage('BASE', 'zh')).toContain('Chinese');
    expect(withMemoryLanguage('BASE', 'auto')).toContain('same language');
    expect(withMemoryLanguage('BASE', 'en')).toContain('English');
    expect(withMemoryLanguage('BASE', 'unknown')).toContain('Chinese');
    expect(withMemoryLanguage('BASE', undefined)).toContain('Chinese');
  });
});
