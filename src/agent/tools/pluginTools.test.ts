import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPluginTools, PluginToolInvoker } from './pluginTools';

const identity = { sessionId: 's', generation: '11111111-1111-4111-8111-111111111111' };
afterEach(() => vi.useRealTimers());
describe('plugin worker Main roundtrip', () => {
  it('forwards progress only while pending and advertises read-only tools', async () => {
    const emit = vi.fn();
    const onUpdate = vi.fn();
    const invoker = new PluginToolInvoker(identity, emit);
    const pending = invoker.invoke('plugin_a-b__read', {}, undefined, 'fp', { onUpdate });
    const requestId = emit.mock.calls[0][0].requestId;
    invoker.progress(requestId, 'working');
    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: 'text', text: 'working' }],
      details: undefined,
    });
    invoker.resolve({ requestId, ok: true, result: {} });
    await pending;
    invoker.progress(requestId, 'late');
    expect(onUpdate).toHaveBeenCalledOnce();
    const [tool] = createPluginTools(
      [
        {
          name: 'plugin_a-b__read',
          description: 'read',
          parameters: { type: 'object' },
          pluginId: 'a.b',
          fingerprint: 'fp',
          readOnly: true,
        },
      ],
      invoker
    );
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });
  it('includes current plugin fingerprint and generation and resolves once', async () => {
    const emit = vi.fn();
    const i = new PluginToolInvoker(identity, emit);
    const result = i.invoke('plugin_a-b__read', {}, undefined, 'fingerprint');
    expect(emit.mock.calls[0][0]).toMatchObject({
      identity,
      toolName: 'plugin_a-b__read',
      fingerprint: 'fingerprint',
    });
    const requestId = emit.mock.calls[0][0].requestId;
    expect(i.resolve({ requestId, ok: true, result: { content: 'ok' } })).toBe(true);
    expect(await result).toEqual({ content: 'ok' });
    expect(i.resolve({ requestId, ok: true })).toBe(false);
  });
  it('abort and shutdown cancel remote requests and settle locally', async () => {
    const cancel = vi.fn();
    const i = new PluginToolInvoker(identity, vi.fn(), { emitCancel: cancel });
    const c = new AbortController();
    const a = i.invoke('t', {}, c.signal, 'fp');
    c.abort();
    await expect(a).rejects.toThrow();
    const b = i.invoke('t', {}, undefined, 'fp');
    i.cancelAll();
    await expect(b).rejects.toThrow();
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(i.pendingCount).toBe(0);
  });
  it('timeout fails closed and cancels remote', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const i = new PluginToolInvoker(identity, vi.fn(), { timeoutMs: 10, emitCancel: cancel });
    const result = i.invoke('t', {}, undefined, 'fp');
    const assertion = expect(result).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(11);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('descriptor execution preserves details and fixed model name with fingerprint', async () => {
    const invoke = vi.fn(async () => ({ content: 'ok', details: { n: 1 } }));
    const [tool] = createPluginTools(
      [
        {
          name: 'plugin_a-b__read',
          description: 'Read',
          parameters: { type: 'object', properties: {} },
          pluginId: 'a.b',
          fingerprint: 'fp',
        },
      ],
      { invoke }
    );
    const result = await tool.execute('call', {}, undefined, undefined, undefined as never);
    expect(invoke).toHaveBeenCalledWith('plugin_a-b__read', {}, undefined, 'fp');
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }], details: { n: 1 } });
  });
});
