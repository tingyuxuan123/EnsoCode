import { describe, expect, it, vi } from 'vitest';
import {
  childPluginEventPlan,
  createPluginEventsExtension,
  PluginEventInvoker,
} from './pluginEvents';

const plan = {
  observe: ['model_select', 'before_agent_start', 'agent_end'] as const,
  intercept: [{ event: 'before_agent_start' as const }, { event: 'tool_call' as const }],
  inject: true,
};
const makePlan = () => ({ ...plan, observe: [...plan.observe] });

describe('native plugin worker events', () => {
  it('child plans retain only tool-call interception and never injection', () => {
    expect(childPluginEventPlan(makePlan())).toEqual({
      observe: plan.observe,
      intercept: [{ event: 'tool_call' }],
      inject: false,
    });
    const invoker = new PluginEventInvoker(makePlan(), vi.fn(), { childSession: true });
    expect(
      invoker.deliver({
        pluginId: 'example.demo',
        pluginName: 'Demo',
        text: 'hi',
        deliverAs: 'steer',
        triggerTurn: true,
      }).ok
    ).toBe(false);
  });

  it('before_agent_start appends bounded context and model_select forwards public model identities', async () => {
    const events: unknown[] = [];
    const handlers = new Map<string, (event: any) => any>();
    const invoker = new PluginEventInvoker(makePlan(), (event) => {
      events.push(event);
      if (event.type === 'plugin-intercept')
        invoker.resolve({
          requestId: event.requestId,
          ok: true,
          result: { append: 'plugin context' },
        });
    });
    const extension = createPluginEventsExtension(invoker) as { factory: (pi: any) => void };
    extension.factory({
      on: (name: string, callback: any) => handlers.set(name, callback),
      sendMessage: vi.fn(),
    });
    expect(
      await handlers.get('before_agent_start')?.({
        messageType: 'user',
        prompt: 'hi',
        systemPrompt: 'base',
      })
    ).toEqual({ systemPrompt: 'base\n\nplugin context' });
    handlers.get('model_select')?.({
      model: { provider: 'p', id: 'm', apiKey: 'secret' },
      source: 'set',
    });
    expect(events).toContainEqual({
      type: 'plugin-event',
      event: 'model_select',
      data: { provider: 'p', modelId: 'm', source: 'set' },
    });
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it('delivers image custom messages and cancellation blocks pending child tools', async () => {
    const invoker = new PluginEventInvoker(makePlan(), vi.fn());
    const send = vi.fn();
    invoker.bindSender(send);
    expect(
      invoker.deliver({
        pluginId: 'example.demo',
        pluginName: 'Demo',
        text: 'hi',
        images: [{ data: 'AAAA', mimeType: 'image/png' }],
        deliverAs: 'nextTurn',
        triggerTurn: false,
      })
    ).toEqual({ ok: true });
    expect(send.mock.calls[0][0].content).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    ]);
    const child = new PluginEventInvoker(makePlan(), vi.fn(), { childSession: true });
    const pending = child.intercept('tool_call', { toolCallId: 'c', toolName: 'bash', input: {} });
    child.cancelAll();
    expect(await pending).toMatchObject({ block: true });
    expect(child.pendingCount).toBe(0);
  });
});
