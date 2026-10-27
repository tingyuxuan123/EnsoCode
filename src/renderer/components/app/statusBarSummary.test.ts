import { describe, expect, it } from 'vitest';
import { summarizeWorkbench } from './statusBarSummary';

describe('summarizeWorkbench', () => {
  it('统计未归档的运行中与待处理会话，忽略已归档与 btw 旁路', () => {
    const summary = summarizeWorkbench({
      a: { status: 'running' },
      b: { status: 'idle', pendingApprovals: [{}] },
      c: { status: 'running', archived: true },
      d: { status: 'running', btwParentId: 'a' },
      e: { status: 'idle', spawning: true },
      f: { status: 'idle', pendingAsks: [{ requestId: 'x' }], pendingCapabilityAsks: [{}] },
      g: undefined,
    });
    expect(summary).toEqual({ running: 2, waiting: 2 });
  });

  it('运行中且待审批的会话只记为待处理', () => {
    expect(summarizeWorkbench({ a: { status: 'running', pendingApprovals: [{}] } })).toEqual({
      running: 0,
      waiting: 1,
    });
  });

  it('空目录返回零', () => {
    expect(summarizeWorkbench({})).toEqual({ running: 0, waiting: 0 });
  });
});
