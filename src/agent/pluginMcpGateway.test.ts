import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { AgentWorkerEvent, SessionIdentity } from '@shared/types/agent';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalGate } from './approval';
import { PluginMcpGateway } from './pluginMcpGateway';

const identity = { sessionId: 'parent', generation: '11111111-1111-4111-8111-111111111111' };
const server = {
  name: 'read-looking-server',
  transport: 'http' as const,
  url: 'https://fixture.invalid/mcp',
};
const call = {
  type: 'plugin-mcp-call' as const,
  identity,
  requestId: 'call',
  servers: [server],
  server: server.name,
  tool: 'send_email',
  args: { to: 'fixture' },
};
function setup(planning = false, mode: 'full' | 'assistant' = 'full') {
  const events: AgentWorkerEvent[] = [];
  let current: SessionIdentity | null = identity;
  const requests: unknown[] = [];
  const gate = new ApprovalGate(
    mode,
    (info) => requests.push(info),
    () => {},
    { protectedFloor: true, review: async () => ({ decision: 'auto_allow' }) }
  );
  const execute = vi.fn(async () => ({
    content: [{ type: 'text' as const, text: 'ok' }],
    details: undefined,
  }));
  const tool = {
    name: 'mcp__read_looking_server__send_email',
    label: `${server.name}: send_email`,
    description: 'send',
    parameters: { type: 'object', properties: {} },
    execute,
  } as unknown as ToolDefinition;
  const gateway = new PluginMcpGateway({
    session: (id) =>
      current?.generation === id.generation ? { gate, planning: () => planning } : null,
    tools: async () => [tool],
    emit: (event) => events.push(event),
  });
  return {
    gateway,
    events,
    requests,
    gate,
    execute,
    setCurrent: (id: SessionIdentity | null) => {
      current = id;
    },
  };
}
describe('PluginMcpGateway', () => {
  it.each(['execute', 'owner-changed', 'revision-changed'] as const)(
    'auto_allow 审计仅在最终校验通过并执行时发布：%s',
    async (change) => {
      const events: AgentWorkerEvent[] = [];
      const review = vi.fn();
      const gate = new ApprovalGate(
        'assistant',
        () => {},
        () => {},
        {
          review: async (info) => ({
            decision: 'auto_allow',
            record: {
              verdict: 'allow',
              model: 'fixture',
              actionHash: info.actionHash!,
              allow: 0.95,
              ask: 0.04,
              block: 0.01,
            },
          }),
        }
      );
      let currentGate = gate;
      const originalAsk = gate.ask.bind(gate);
      vi.spyOn(gate, 'ask').mockImplementation(async (...args) => {
        const result = await originalAsk(...args);
        if (change === 'owner-changed')
          currentGate = new ApprovalGate(
            'full',
            () => {},
            () => {}
          );
        if (change === 'revision-changed') gate.mode = 'full';
        return result;
      });
      const execute = vi.fn(async () => ({
        content: [{ type: 'text' as const, text: 'ok' }],
        details: undefined,
      }));
      const gateway = new PluginMcpGateway({
        session: () => ({
          gate: currentGate,
          planning: () => false,
          recordScope: `plugin-mcp-audit-${change}`,
          review,
        }),
        tools: async () => [
          {
            name: 'mcp__fixture__lookup',
            label: `${server.name}: lookup`,
            description: 'Lookup',
            parameters: { type: 'object', properties: {} },
            execute,
          } as unknown as ToolDefinition,
        ],
        emit: (event) => events.push(event),
      });
      gateway.handle({ ...call, tool: 'lookup', requestId: `audit-${change}` });
      await vi.waitFor(() => expect(events).toHaveLength(1));
      if (change === 'execute') {
        expect(execute).toHaveBeenCalledOnce();
        expect(review).toHaveBeenCalledWith(
          'mcp__fixture__lookup',
          expect.objectContaining({ verdict: 'allow' })
        );
        expect(events[0]).toMatchObject({ ok: true });
      } else {
        expect(execute).not.toHaveBeenCalled();
        expect(review).not.toHaveBeenCalled();
        expect(events[0]).toMatchObject({ ok: false });
      }
      gateway.close();
    }
  );
  it('规划或过期generation的插件内层MCP拒绝，不触发真实工具', async () => {
    for (const planning of [true, false]) {
      const h = setup(planning);
      if (!planning) h.setCurrent(null);
      h.gateway.handle(call);
      await vi.waitFor(() => expect(h.events).toHaveLength(1));
      expect(h.events[0]).toMatchObject({ type: 'plugin-mcp-result', identity, ok: false });
      expect(h.execute).not.toHaveBeenCalled();
      h.gateway.close();
    }
  });
  it('真实原始工具名含发送行为，不能被read前缀或assistant代审绕过真人底线', async () => {
    const h = setup(false, 'assistant');
    h.gateway.handle(call);
    await vi.waitFor(() => expect(h.requests).toHaveLength(1));
    expect(h.requests[0]).toMatchObject({
      protected: 'external-send',
      tool: 'mcp__read_looking_server__send_email',
    });
    expect(h.execute).not.toHaveBeenCalled();
    const info = h.requests[0] as { requestId: string };
    h.gate.respond(info.requestId, 'deny');
    await vi.waitFor(() => expect(h.events).toHaveLength(1));
    expect(h.events[0]).toMatchObject({ ok: false });
    h.gateway.close();
  });
  it('列工具只返回原始名称；exact cancel取消等待，不接受其他代际的cancel', async () => {
    const h = setup(false, 'assistant');
    h.gateway.handle({ ...call, type: 'plugin-mcp-list', requestId: 'list' });
    await vi.waitFor(() => expect(h.events).toHaveLength(1));
    expect(h.events[0]).toMatchObject({
      ok: true,
      value: [{ server: server.name, name: 'send_email' }],
    });
    h.gateway.handle(call);
    await vi.waitFor(() => expect(h.requests).toHaveLength(1));
    h.gateway.handle({
      type: 'plugin-mcp-cancel',
      identity: { ...identity, generation: 'other' },
      requestId: 'call',
    });
    expect(h.gate.snapshot()).toHaveLength(1);
    h.gateway.handle({ type: 'plugin-mcp-cancel', identity, requestId: 'call' });
    await vi.waitFor(() => expect(h.events).toHaveLength(2));
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.gate.snapshot()).toHaveLength(0);
    h.gateway.close();
  });
});
