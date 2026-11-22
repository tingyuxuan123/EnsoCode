import { describe, expect, it } from 'vitest';
import {
  WIKI_COMPILE_GROUP_SCOPE_RULES,
  WIKI_COMPILE_PROMPT,
  WIKI_REWRITE_PROMPT,
  WIKI_VERIFY_PROMPT,
  withMemoryLanguage,
} from './prompts';

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

  it('requires in-place rewrites instead of append-style revision history', () => {
    const prompt = WIKI_COMPILE_PROMPT.toLowerCase();
    expect(prompt).toContain('rewrite in place');
    expect(prompt).toContain('changelog');
    expect(prompt).toContain('conclusions, not the path');
    expect(WIKI_REWRITE_PROMPT).toContain('Output the body only');
  });

  it('tells the compiler how to maintain the status page', () => {
    const prompt = WIKI_COMPILE_PROMPT.toLowerCase();
    expect(prompt).toContain('status page');
    expect(prompt).toContain('60 lines');
    expect(prompt).toContain('as of');
  });

  it('audits notes against their evidence instead of trusting the writer', () => {
    const prompt = WIKI_VERIFY_PROMPT.toLowerCase();
    expect(prompt).toContain('evidence');
    expect(prompt).toContain('unsupported');
    expect(prompt).toContain('verdicts');
  });
});
