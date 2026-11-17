import type { PluginAgentRunEvent } from '@shared/extensionPlugins/protocol';
import { describe, expect, it } from 'vitest';
import { PluginAgentRuns } from './agentRuns';

const identity = { sessionId: 's1', generation: 'g1' };
const input = { prompt: '改写', context: 'none' as const, timeoutMs: 60_000 };

describe('PluginAgentRuns', () => {
  it('发送 run 命令，按 requestId 回调到终态，取消只发一次', () => {
    const sent: Record<string, unknown>[] = [];
    const runs = new PluginAgentRuns((command) => {
      sent.push(command as unknown as Record<string, unknown>);
      return true;
    });
    const seen: PluginAgentRunEvent[] = [];
    const started = runs.start(identity, input, (event) => seen.push(event));
    expect(started.ok).toBe(true);
    const { requestId } = sent[0] as { requestId: string };
    expect(sent[0]).toEqual({ type: 'plugin-agent-run', requestId, identity, ...input });
    const ev = (event: PluginAgentRunEvent) => ({
      type: 'plugin-agent-event' as const,
      requestId,
      event,
    });
    expect(runs.settle(ev({ type: 'text', text: 'a' }))).toBe(true);
    expect(runs.settle(ev({ type: 'end', ok: true, text: 'b' }))).toBe(true);
    expect(runs.settle(ev({ type: 'text', text: 'late' }))).toBe(true);
    expect(seen).toEqual([
      { type: 'text', text: 'a' },
      { type: 'end', ok: true, text: 'b' },
    ]);
    if (started.ok) started.cancel();
    // 终态后表项已删，取消不再下发
    expect(sent).toHaveLength(1);
  });

  it('取消发 cancel；worker 不可用或退出时如实收尾', () => {
    const sent: Record<string, unknown>[] = [];
    let up = true;
    const runs = new PluginAgentRuns((command) => {
      sent.push(command as unknown as Record<string, unknown>);
      return up;
    });
    const model = {
      api: 'openai-completions',
      apiKey: 'k',
      baseUrl: 'https://example.invalid',
      modelId: 'm1',
      settingsProviderId: 'p1',
    };
    runs.start(identity, { ...input, model } as never, () => {});
    expect(sent[0]).toMatchObject({ model });
    const cancelable = runs.start(identity, input, () => {});
    if (cancelable.ok) cancelable.cancel();
    expect(sent.at(-1)).toEqual({
      type: 'plugin-agent-cancel',
      requestId: (sent[1] as { requestId: string }).requestId,
    });
    const seen: PluginAgentRunEvent[] = [];
    runs.start(identity, input, (event) => seen.push(event));
    runs.failAll('agent worker exited');
    expect(seen).toEqual([{ type: 'end', ok: false, error: 'agent worker exited' }]);
    up = false;
    expect(runs.start(identity, input, () => {})).toEqual({ ok: false, error: '无法启动代理' });
  });
});
