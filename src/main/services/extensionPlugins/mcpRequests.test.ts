import { describe, expect, it } from 'vitest';
import { type PluginMcpCommand, PluginMcpRequests } from './mcpRequests';

const identity = { sessionId: 's', generation: '11111111-1111-4111-8111-111111111111' };
describe('plugin MCP exact identity requests', () => {
  it('does not settle cross-generation forged results and emits identity on cancellation', async () => {
    const sent: PluginMcpCommand[] = [];
    const r = new PluginMcpRequests((c) => {
      sent.push(c);
      return true;
    });
    const controller = new AbortController();
    const pending = r.list({ identity, servers: [] }, controller.signal);
    const requestId = sent[0].requestId;
    expect(
      r.settle({
        type: 'plugin-mcp-result',
        requestId,
        identity: { ...identity, generation: 'other' },
        ok: true,
        value: [],
      })
    ).toBe(false);
    expect(r.pendingCount).toBe(1);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    expect(sent.at(-1)).toEqual({ type: 'plugin-mcp-cancel', requestId, identity });
  });
  it('settles matching worker response, fails on worker shutdown and offline', async () => {
    const sent: PluginMcpCommand[] = [];
    const r = new PluginMcpRequests((c) => {
      sent.push(c);
      return true;
    });
    const a = r.call(
      { identity, servers: [], server: 's', tool: 'actual_inner_name', args: {} },
      new AbortController().signal
    );
    r.settle({
      type: 'plugin-mcp-result',
      identity,
      requestId: sent[0].requestId,
      ok: true,
      value: { content: 'ok', isError: false },
    });
    expect(await a).toEqual({ content: 'ok', isError: false });
    const b = r.list({ identity, servers: [] }, new AbortController().signal);
    r.failAll('worker exited');
    await expect(b).rejects.toThrow('worker exited');
    const offline = new PluginMcpRequests(() => false);
    await expect(
      offline.list({ identity, servers: [] }, new AbortController().signal)
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });
});
