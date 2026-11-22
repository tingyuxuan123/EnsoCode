import { describe, expect, it } from 'vitest';
import { buildMemoryStartupBlock, MEMORY_STARTUP_MAX_STATUS_CHARS } from './startupPrompt';

describe('memory startup block', () => {
  it('still explains an empty vault instead of staying silent', () => {
    const block = buildMemoryStartupBlock({ noteCount: 0, status: null }) ?? '';
    // 空库也要说清“记忆库存在、目前为空、该怎么用”，否则新项目永远学不会用记忆
    expect(block).toContain('Project memory');
    expect(block).toContain('no notes yet');
    expect(block).toContain('memory_upsert');
    expect(block).not.toContain('Current status');
  });

  it('points the agent at the tools when notes exist without a status page', () => {
    const block = buildMemoryStartupBlock({ noteCount: 4, status: null }) ?? '';
    expect(block).toContain('4');
    expect(block).toContain('memory_index');
    expect(block).toContain('memory_search');
    expect(block).toContain('memory_read');
    expect(block).not.toContain('Current status');
  });

  it.each([0, 4])('在有 %i 篇笔记时仍引导当轮记住明确约定并如实报告', (noteCount) => {
    const block = buildMemoryStartupBlock({ noteCount, status: null }) ?? '';
    expect(block).toMatch(
      /explicitly asks .*remember.*lasting.*memory_search or memory_index.*memory_upsert.*same turn/i
    );
    expect(block).toMatch(/report the actual result and page/i);
    expect(block).toMatch(/never say it was saved.*approval is pending.*write failed/i);
    expect(block).toMatch(/Do not save routine Q&A/i);
  });

  it('inlines the status page because it is the cheapest thing to read first', () => {
    const block =
      buildMemoryStartupBlock({
        noteCount: 2,
        status: {
          slug: 'status',
          title: '项目状态',
          body: 'As of 2026-06-01\n\n- 正在做：status 页',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      }) ?? '';
    expect(block).toContain('Current status');
    expect(block).toContain('As of 2026-06-01');
    expect(block).toContain('正在做');
  });

  it('truncates a runaway status body instead of blowing up the prompt', () => {
    const block =
      buildMemoryStartupBlock({
        noteCount: 1,
        status: {
          slug: 'status',
          title: '项目状态',
          body: 'x'.repeat(MEMORY_STARTUP_MAX_STATUS_CHARS + 500),
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      }) ?? '';
    expect(block).not.toContain('x'.repeat(MEMORY_STARTUP_MAX_STATUS_CHARS + 1));
    expect(block).toContain('truncated');
  });

  it('tells the agent it owns the status page while the session is still running', () => {
    const block = buildMemoryStartupBlock({ noteCount: 2, status: null }) ?? '';
    expect(block).toContain('memory_upsert');
    expect(block).toContain('status');
    expect(block).toContain('As of');
  });

  it('warns when the repository has commits newer than the memory', () => {
    const block =
      buildMemoryStartupBlock({
        noteCount: 3,
        status: null,
        memoryUpdatedAt: '2026-06-01T10:00:00.000Z',
        codeUpdatedAt: '2026-06-05T10:00:00.000Z',
      }) ?? '';
    expect(block).toContain('2026-06-05');
    expect(block).toContain('newer than this memory');
  });

  it('stays quiet when the code is not newer than the memory', () => {
    const sameDay =
      buildMemoryStartupBlock({
        noteCount: 3,
        status: null,
        memoryUpdatedAt: '2026-06-05T09:00:00.000Z',
        codeUpdatedAt: '2026-06-05T18:00:00.000Z',
      }) ?? '';
    expect(sameDay).not.toContain('newer than this memory');

    const older =
      buildMemoryStartupBlock({
        noteCount: 3,
        status: null,
        memoryUpdatedAt: '2026-06-05T09:00:00.000Z',
        codeUpdatedAt: '2026-06-02T18:00:00.000Z',
      }) ?? '';
    expect(older).not.toContain('newer than this memory');

    const unknown =
      buildMemoryStartupBlock({ noteCount: 3, status: null, memoryUpdatedAt: null }) ?? '';
    expect(unknown).not.toContain('newer than this memory');
  });
});
