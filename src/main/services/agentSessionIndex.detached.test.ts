import { describe, expect, it } from 'vitest';
import { AgentSessionIndex } from './agentSessionIndex';

describe('detached session dispatch boundary', () => {
  it('released/failed/exited sessions reject delivery until prepare or ready', () => {
    const identity = { sessionId: 'root', generation: 'g1' };
    const index = new AgentSessionIndex({ readSettings: () => null });
    index.prepareParent(identity);
    expect(index.isDetached(identity)).toBe(false);
    for (const end of [
      { type: 'parent-ended' as const, identity, seq: 1, reason: 'evicted' },
      { type: 'parent-rejected' as const, identity, seq: 0, reason: 'failed spawn' },
      { type: 'worker-exited' as const },
    ]) {
      index.observe(end);
      expect(index.isDetached(identity)).toBe(true);
      expect(index.isDetached({ ...identity, generation: 'old' })).toBe(false);
      index.prepareParent(identity);
      expect(index.isDetached(identity)).toBe(false);
    }
    index.observe({ type: 'parent-ended', identity, seq: 1, reason: 'evicted' });
    index.observe({
      type: 'parent-ready',
      identity,
      seq: 1,
      sessionFile: '/tmp/root.jsonl',
      model: { providerId: 'p', modelId: 'm' },
    });
    expect(index.isDetached(identity)).toBe(false);
  });
});
