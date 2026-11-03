import { designToolTimeoutMs } from '@shared/types/design';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesignTools, DesignInvoker } from './design';

const identity = { sessionId: 's1', generation: '11111111-1111-4111-8111-111111111111' };
const result = {
  content: [
    { type: 'text' as const, text: 'ok' },
    { type: 'image' as const, data: 'abc', mimeType: 'image/png' },
  ],
  details: { path: 'demo.vetd' },
};
afterEach(() => vi.useRealTimers());
describe('DesignInvoker', () => {
  it.each([
    { ok: true, vetdPath: '/work/ride.vetd' },
    { ok: false, created: true, retryable: true, vetdPath: '/work/ride.vetd' },
  ])(
    'refreshes design tools when a package was created, including failed canvas open: %j',
    async (details) => {
      const emit = vi.fn();
      const created = vi.fn();
      const invoker = new DesignInvoker(identity, emit);
      const create = createDesignTools(invoker, { created })[0];
      const pending = create.execute(
        'create',
        { product: 'mobile' },
        undefined,
        undefined,
        undefined as never
      );
      invoker.resolve({
        requestId: emit.mock.calls[0][0].requestId,
        ok: true,
        result: { content: [{ type: 'text', text: JSON.stringify(details) }], details },
      });
      await pending;
      expect(created).toHaveBeenCalledOnce();
    }
  );
  it.each([
    { ok: false },
    { ok: false, created: true },
    { ok: false, created: true, vetdPath: '/work/not-a-design' },
  ])('does not refresh tools when create did not prove a package exists: %j', async (details) => {
    const emit = vi.fn();
    const created = vi.fn();
    const invoker = new DesignInvoker(identity, emit);
    const create = createDesignTools(invoker, { created })[0];
    const pending = create.execute(
      'create',
      { product: 'mobile' },
      undefined,
      undefined,
      undefined as never
    );
    invoker.resolve({
      requestId: emit.mock.calls[0][0].requestId,
      ok: true,
      result: { content: [{ type: 'text', text: JSON.stringify(details) }] },
    });
    await pending;
    expect(created).not.toHaveBeenCalled();
  });
  it('routes text/images and errors; drops late results and handles send failure', async () => {
    const emit = vi.fn();
    const invoker = new DesignInvoker(identity, emit);
    const tools = createDesignTools(invoker);
    const promise = tools[0].execute(
      'call',
      { product: 'poster' },
      undefined,
      undefined,
      undefined as never
    );
    const request = emit.mock.calls[0][0];
    expect(request).toMatchObject({ identity, tool: 'vetd_create', params: { product: 'poster' } });
    invoker.resolve({ requestId: request.requestId, ok: true, result });
    await expect(promise).resolves.toEqual(result);
    expect(invoker.resolve({ requestId: request.requestId, ok: true, result })).toBe(false);
    const failed = invoker.invoke('vetd_status', {});
    invoker.resolve({
      requestId: emit.mock.calls[1][0].requestId,
      ok: false,
      error: 'unavailable',
    });
    await expect(failed).rejects.toThrow('unavailable');
    const broken = new DesignInvoker(identity, () => {
      throw new Error('send failed');
    });
    await expect(broken.invoke('vetd_status', {})).rejects.toThrow('send failed');
    expect(broken.pendingCount).toBe(0);
  });
  it('cancels exactly once on abort, per-tool timeout and session end', async () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const emitCancel = vi.fn();
    const invoker = new DesignInvoker(identity, emit, { emitCancel });
    await expect(invoker.invoke('vetd_status', {}, AbortSignal.abort())).rejects.toThrow(/abort/i);
    expect(emit).not.toHaveBeenCalled();
    const controller = new AbortController();
    const aborted = invoker.invoke('vetd_status', {}, controller.signal);
    controller.abort();
    await expect(aborted).rejects.toThrow(/abort/i);
    const short = invoker.invoke('vetd_status', {});
    const long = invoker.invoke('vetd_install', {});
    vi.advanceTimersByTime(designToolTimeoutMs('vetd_status'));
    await expect(short).rejects.toThrow(/timed out/i);
    expect(invoker.pendingCount).toBe(1);
    invoker.cancelAll('Session ended');
    invoker.cancelAll();
    await expect(long).rejects.toThrow('Session ended');
    expect(emitCancel).toHaveBeenCalledTimes(3);
    expect(invoker.pendingCount).toBe(0);
  });
  it('normalizes JSON, nested numbers/booleans and maps before SDK schema validation', async () => {
    const emit = vi.fn();
    const invoker = new DesignInvoker(identity, emit);
    const tools = createDesignTools(invoker);
    const create = tools[0];
    const normalized = create.prepareArguments?.({
      frameSize: '{"width":"800","height":"600"}',
      intent: '{"goAhead":"true"}',
      screens: '["login"]',
      stray: 'drop',
    });
    expect(normalized).toEqual({
      frameSize: { width: 800, height: 600 },
      intent: { goAhead: true },
      screens: ['login'],
    });
    const direction = tools.find((tool) => tool.name === 'vetd_direction')!;
    expect(
      direction.prepareArguments?.({ action: ' CHOOSE ', answers: '{"tone":"bold"}' })
    ).toEqual({ action: 'choose', answers: { tone: 'bold' } });
    const install = tools.find((tool) => tool.name === 'vetd_install')!;
    await expect(
      install.execute('call', {} as never, undefined, undefined, undefined as never)
    ).rejects.toThrow();
    expect(emit).not.toHaveBeenCalled();
    const exportTool = tools.find((tool) => tool.name === 'vetd_export')!;
    await expect(
      exportTool.execute(
        'call',
        { format: 'pdf', frames: [] },
        undefined,
        undefined,
        undefined as never
      )
    ).rejects.toThrow();
  });
});
