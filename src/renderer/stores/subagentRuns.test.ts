import type { AgentRunProgress } from '@shared/types/agent';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSubagentRunsStore } from './subagentRuns';

const run = (runId: string): AgentRunProgress => ({
  agentId: 'a',
  runId,
  status: 'running',
  elapsedMs: 0,
});

describe('useSubagentRunsStore', () => {
  beforeEach(() => useSubagentRunsStore.setState({ byConversation: {} }));

  it('replace 整体替换该会话快照，不与旧值合并', () => {
    const { replace } = useSubagentRunsStore.getState();
    replace('c1', [run('r1'), run('r2')]);
    replace('c1', [run('r3')]);
    expect(useSubagentRunsStore.getState().byConversation.c1).toEqual([run('r3')]);
  });

  it('空快照删键，且不影响其他会话', () => {
    const { replace } = useSubagentRunsStore.getState();
    replace('c1', [run('r1')]);
    replace('c2', [run('r2')]);
    replace('c1', []);
    expect(useSubagentRunsStore.getState().byConversation).toEqual({ c2: [run('r2')] });
  });

  it('running 到空快照仍推进 revision，迟到初始查询不能复活旧进度', () => {
    const before = useSubagentRunsStore.getState().revisionByConversation?.c1 ?? 0;
    useSubagentRunsStore.getState().replace('c1', [run('r1')]);
    useSubagentRunsStore.getState().replace('c1', []);
    expect(useSubagentRunsStore.getState().revisionByConversation?.c1 ?? 0).toBeGreaterThan(before);
  });
});
