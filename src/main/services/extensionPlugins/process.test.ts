import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginProcess } from './process';

class Child extends EventEmitter {
  inbox: unknown[] = [];
  postMessage(m: unknown) {
    this.inbox.push(m);
  }
  kill() {
    queueMicrotask(() => this.emit('exit', 0));
    return true;
  }
}
const live: PluginProcess[] = [];
afterEach(() => {
  for (const p of live.splice(0)) p.stop();
  vi.useRealTimers();
});
function setup() {
  const children: Child[] = [];
  const onExit = vi.fn();
  const p = new PluginProcess({
    hostPath: '/host',
    env: {},
    init: { pluginId: 'a.b', pluginRoot: '/plugin', main: 'main.mjs', dataDir: '/data' },
    fork: () => {
      const c = new Child();
      children.push(c);
      queueMicrotask(() => c.emit('spawn'));
      return c;
    },
    handleHostCall: async () => 'host',
    onExit,
    idleMs: 100,
    readyTimeoutMs: 50,
  });
  live.push(p);
  return { p, children, onExit };
}
const registered = { tools: [], commands: [], triggers: [], rendererMethods: [] };
async function ready(s: ReturnType<typeof setup>) {
  const promise = s.p.ready();
  await Promise.resolve();
  s.children.at(-1)!.emit('message', { t: 'ready', registered });
  await promise;
}
describe('plugin process isolation lifecycle', () => {
  it('lazily forks and initializes, executes and routes host responses', async () => {
    const s = setup();
    expect(s.children).toHaveLength(0);
    await ready(s);
    expect(s.children[0].inbox[0]).toMatchObject({ t: 'init', pluginId: 'a.b' });
    const response = s.p.call(
      'tool.execute',
      {},
      { invocationId: 'i', sessionId: 's', projectRoot: null, timeoutMs: 1000 }
    );
    await Promise.resolve();
    const c = s.children[0];
    const call = c.inbox.at(-1) as { id: string };
    c.emit('message', { t: 'res', id: call.id, ok: true, value: 'ok' });
    expect(await response).toBe('ok');
    c.emit('message', { t: 'call', id: 'h', api: 'config.get', args: {} });
    await Promise.resolve();
    await Promise.resolve();
    await vi.waitFor(() =>
      expect(c.inbox).toContainEqual({ t: 'res', id: 'h', ok: true, value: 'host' })
    );
  });
  it('cancel during startup prevents dispatch after ready', async () => {
    const s = setup();
    const result = s.p.call(
      'tool.execute',
      {},
      { invocationId: 'i', sessionId: 's', projectRoot: null, timeoutMs: 1000 }
    );
    const assertion = expect(result).rejects.toMatchObject({ code: 'ABORTED' });
    s.p.cancel('i');
    await Promise.resolve();
    s.children[0].emit('message', { t: 'ready', registered });
    await assertion;
    expect(s.children[0].inbox.some((m) => (m as { t: string }).t === 'call')).toBe(false);
  });
  it('stop settles pending even if child never emits exit', async () => {
    const s = setup();
    await ready(s);
    const c = s.children[0];
    c.kill = () => true;
    const result = s.p.call(
      'tool.execute',
      {},
      { invocationId: 'i', sessionId: null, projectRoot: null, timeoutMs: 1000 }
    );
    await Promise.resolve();
    s.p.stop();
    await expect(result).rejects.toMatchObject({ code: 'PLUGIN_EXITED' });
    expect(s.p.running).toBe(false);
  });
  it('timeouts cancel invocation and drop late response', async () => {
    vi.useFakeTimers();
    const s = setup();
    await ready(s);
    const result = s.p.call(
      'renderer.call',
      {},
      { invocationId: 'i', sessionId: null, projectRoot: null, timeoutMs: 10 }
    );
    const assertion = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(11);
    await assertion;
    expect(s.children[0].inbox).toContainEqual({ t: 'cancel', invocationId: 'i' });
  });
  it('startup timeout fails and idle exits do not count as crashes', async () => {
    vi.useFakeTimers();
    const s = setup();
    const result = s.p.ready();
    const assertion = expect(result).rejects.toMatchObject({ code: 'PLUGIN_INIT_FAILED' });
    await vi.advanceTimersByTimeAsync(51);
    await assertion;
    await ready(s);
    await vi.advanceTimersByTimeAsync(101);
    expect(s.onExit).toHaveBeenLastCalledWith({ unexpected: false });
  });
});
