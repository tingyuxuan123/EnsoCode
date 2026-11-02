import { describe, expect, it } from 'vitest';
import type { CompactFacts } from './extract';
import {
  assembleFallback,
  assemblePrompt,
  chunkSummaryPrompt,
  compactSummaryPrompt,
  patchCompactSummary,
  SUMMARY_SECTIONS,
} from './summarize';

const facts = (partial: Partial<CompactFacts> = {}): CompactFacts => ({
  goal: '',
  constraints: [],
  errors: [],
  files: [],
  readFiles: [],
  modifiedFiles: [],
  completedTodos: [],
  activeTodos: [],
  openLoops: [],
  ...partial,
});

describe('compact summary prompts', () => {
  it('单趟与合并摘要保留用户最新请求、授权边界、纠正和未答问题', () => {
    expect(SUMMARY_SECTIONS).toContain('## User Context');
    for (const prompt of [compactSummaryPrompt(facts(), 'T'), assemblePrompt(facts(), ['C'])]) {
      for (const text of [
        '## User Context',
        'Latest request:',
        'Approvals:',
        'Corrections:',
        'Unanswered questions:',
      ])
        expect(prompt).toContain(text);
      expect(prompt).toContain('never present a proposal as agreed');
      expect(prompt).toContain('do not invent approvals');
      expect(prompt).toContain('agent-notification');
      expect(prompt).toContain('not user requests, constraints, or approvals');
    }
    const chunk = chunkSummaryPrompt(facts(), 'C', 0, 1);
    expect(chunk).toContain('**User**:');
    expect(chunk).toContain('approvals with their limits');
  });

  it('降级拼装保留旧的用户上下文，缺失时不伪造授权', () => {
    const previous =
      '## User Context\n- Approvals: tests only, no publish\n- Corrections: keep local edits';
    const fallback = assembleFallback(facts(), ['**User**: latest request'], previous);
    expect(fallback).toContain('Approvals: tests only, no publish');
    expect(fallback).toContain('Corrections: keep local edits');
    expect(fallback).toContain('**User**: latest request');
    expect(assembleFallback(facts(), [])).not.toContain('Approvals:');
    expect(patchCompactSummary(previous, facts())).toBe(previous);
  });
  it('单趟提示包含续写摘要、进度模板和对话', () => {
    const prompt = compactSummaryPrompt(facts(), 'TRANSCRIPT', 'PREV');
    for (const text of [
      'PREVIOUS SUMMARY',
      'PREV',
      '### Done',
      '### In Progress',
      '### Blocked',
      '<conversation>',
      'TRANSCRIPT',
    ])
      expect(prompt).toContain(text);
    expect(compactSummaryPrompt(facts(), 'TRANSCRIPT')).not.toContain('PREVIOUS SUMMARY');
  });
  it('把过长的上次摘要截到一万二千字符', () => {
    const prompt = compactSummaryPrompt(facts(), 'TRANSCRIPT', `${'a'.repeat(12_400)}ZZTAIL`);
    expect(prompt).toContain('a'.repeat(100));
    expect(prompt).not.toContain('ZZTAIL');
  });
  it('分块提示包含块序号和正文', () => {
    const prompt = chunkSummaryPrompt(facts(), 'CHUNKTEXT', 1, 3);
    expect(prompt).toContain('CHUNK 2/3');
    expect(prompt).toContain('CHUNKTEXT');
  });
  it('组装提示包含不可变事实、所有块和旧摘要', () => {
    const chunks = ['### CHUNK 1/2: a', '### CHUNK 2/2: b'];
    const prompt = assemblePrompt(facts({ modifiedFiles: ['src/m.ts'] }), chunks, 'PREV');
    for (const text of ['IMMUTABLE', 'src/m.ts', ...chunks, 'PREV']) expect(prompt).toContain(text);
  });
  it('组装失败时确定性保留目标、进度和块摘要', () => {
    const result = assembleFallback(facts({ goal: 'ship', completedTodos: ['done-x'] }), [
      'chunk-a',
    ]);
    for (const text of ['## Goal', 'ship', '## Progress', 'done-x', 'chunk-a'])
      expect(result).toContain(text);
  });
  it('补齐修改文件和已完成进度且不重复已有段落', () => {
    const f = facts({ modifiedFiles: ['src/m.ts'], completedTodos: ['done-x'] });
    const patched = patchCompactSummary('## Goal\nship', f);
    for (const text of ['## Files Modified', 'src/m.ts', '## Progress', '### Done', '- [x] done-x'])
      expect(patched).toContain(text);
    const complete = patchCompactSummary(
      '## Goal\nx\n## Progress\n### Done\n- [x] y\n## Files Modified\n- src/m.ts',
      f
    );
    expect(complete.match(/## Files Modified/g)).toHaveLength(1);
  });
  it('导出固定的进度与下一步摘要段', () => {
    expect(SUMMARY_SECTIONS).toEqual(expect.arrayContaining(['## Progress', '## Next Steps']));
  });
  it('失败组装嵌入旧摘要而不重复顶层目标段', () => {
    const result = assembleFallback(
      facts({ goal: 'ship' }),
      ['c'],
      '## Goal\nold\n## Progress\n### Done\n- [x] y'
    );
    expect(result.match(/^## Goal/gm)).toHaveLength(1);
    expect(result).toContain('old');
  });
});
