import { describe, expect, it } from 'vitest';
import { parseMemoryCapture, parseMemorySearchHits } from './memorySearchHits';

const hit = (over: Record<string, unknown> = {}) => ({
  id: 'proj:3e8d::wiki/decisions/rtk.md',
  slug: 'decisions/rtk',
  title: 'RTK 采用官方 prebuilt',
  snippet: '随应用分发，默认开启',
  type: 'decisions',
  status: 'verified',
  spaceId: 'proj:3e8d',
  ...over,
});

describe('parseMemorySearchHits', () => {
  it('把 Main bridge 投影的 JSON 解析为命中列表，并区分全局/项目空间', () => {
    const output = JSON.stringify({
      results: [
        hit(),
        hit({
          id: 'global::wiki/preferences/lang.md',
          slug: 'preferences/lang',
          spaceId: 'global',
          type: 'preferences',
          status: 'draft',
        }),
      ],
    });
    expect(parseMemorySearchHits(output)).toEqual([
      {
        id: 'proj:3e8d::wiki/decisions/rtk.md',
        slug: 'decisions/rtk',
        title: 'RTK 采用官方 prebuilt',
        content: '随应用分发，默认开启',
        noteType: 'decisions',
        status: 'verified',
        space: 'project',
      },
      {
        id: 'global::wiki/preferences/lang.md',
        slug: 'preferences/lang',
        title: 'RTK 采用官方 prebuilt',
        content: '随应用分发，默认开启',
        noteType: 'preferences',
        status: 'draft',
        space: 'global',
      },
    ]);
  });

  it('空结果是合法命中列表，而不是解析失败', () => {
    expect(parseMemorySearchHits('{"results":[]}')).toEqual([]);
  });

  it('可选字段缺失或非法时置空，不拖垮整条结果', () => {
    expect(
      parseMemorySearchHits(
        JSON.stringify({
          results: [hit({ type: undefined, status: 'unknown', spaceId: 'team:x' })],
        })
      )
    ).toEqual([
      {
        id: 'proj:3e8d::wiki/decisions/rtk.md',
        slug: 'decisions/rtk',
        title: 'RTK 采用官方 prebuilt',
        content: '随应用分发，默认开启',
        noteType: null,
        status: null,
        space: null,
      },
    ]);
  });

  it.each([
    ['null', null],
    ['空串', ''],
    ['错误文本', 'Memory is disabled'],
    ['超长输出外置回执', '[output externalized: 40000 chars → /tmp/x.txt]'],
    ['非对象', '[1,2]'],
    ['缺 results', '{"error":"no_project"}'],
    ['results 非数组', '{"results":"x"}'],
    ['条目缺正文', JSON.stringify({ results: [hit({ snippet: undefined })] })],
    ['条目 id 为空', JSON.stringify({ results: [hit({ id: '' })] })],
    ['条目非对象', '{"results":[null]}'],
  ])('形状不符（%s）返回 null，交给调用方回退原文', (_label, output) => {
    expect(parseMemorySearchHits(output)).toBeNull();
  });
});

describe('parseMemoryCapture (memory_upsert)', () => {
  const receipt = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      status: 'created',
      written: true,
      spaceId: 'proj:3e8d',
      relPath: 'wiki/incidents/tool-row.md',
      slug: 'incidents/tool-row',
      title: '工具行不能整段隐藏输出',
      type: 'incidents',
      noteStatus: 'draft',
      ...over,
    });

  it('写入/更新成功：正文取自调用参数', () => {
    expect(parseMemoryCapture(receipt(), '捎带提醒会被一起藏掉')).toEqual({
      written: true,
      action: 'created',
      memory: {
        id: 'proj:3e8d::wiki/incidents/tool-row.md',
        slug: 'incidents/tool-row',
        title: '工具行不能整段隐藏输出',
        content: '捎带提醒会被一起藏掉',
        noteType: 'incidents',
        status: 'draft',
        space: 'project',
      },
    });
    expect(parseMemoryCapture(receipt({ status: 'updated' }), 'x')).toMatchObject({
      written: true,
      action: 'updated',
    });
  });

  it('Bot 写共享空间进入待审批队列', () => {
    const out = JSON.stringify({
      status: 'pending_review',
      written: false,
      pendingId: 'pend-1',
      spaceId: 'global',
      slug: 'notes/shared',
      title: '共享规则',
    });
    expect(parseMemoryCapture(out, '正文')).toEqual({
      written: false,
      pendingReview: true,
      memory: {
        id: 'pend-1',
        slug: 'notes/shared',
        title: '共享规则',
        content: '正文',
        noteType: null,
        status: 'draft',
        space: 'global',
      },
    });
  });

  it.each([
    ['错误文本', 'Memory is disabled', 'x'],
    ['写入成功但缺正文参数', receipt(), undefined],
    ['未知状态', '{"status":"skipped","title":"x"}', 'x'],
  ])('形状不符（%s）返回 null，交给调用方回退原文', (_label, output, content) => {
    expect(parseMemoryCapture(output, content)).toBeNull();
  });
});
