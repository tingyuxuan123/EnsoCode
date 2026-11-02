import { beforeEach, expect, it, vi } from 'vitest';
import { designTools } from './host/registry';
import { dispatchDesignTool } from './runtime-dispatch';

beforeEach(() => designTools.clear());
it('dispatches input, authoritative session and cancellation signal', async () => {
  const abort = new AbortController();
  const handler = vi.fn(({ session, trigger, signal }) => ({
    cwd: session.cwd,
    id: session.id,
    input: trigger.input,
    aborted: signal.aborted,
  }));
  designTools.set('vetd_status', { id: 'status', description: '', parameters: {}, handler });
  const result = await dispatchDesignTool(
    {
      requestId: 'r',
      tool: 'vetd_status',
      params: { a: 1 },
      session: { sessionId: 's', cwd: '/work' },
    },
    abort.signal,
    { fs: {}, conversation: {} } as never
  );
  expect(result.content).toEqual([
    { type: 'text', text: '{"cwd":"/work","id":"s","input":{"a":1},"aborted":false}' },
  ]);
});
it('rejects missing tools and already cancelled requests', async () => {
  const request = {
    requestId: 'r',
    tool: 'vetd_status' as const,
    params: {},
    session: { sessionId: 's', cwd: '/work' },
  };
  await expect(
    dispatchDesignTool(request, new AbortController().signal, {} as never)
  ).rejects.toThrow('not registered');
  const abort = new AbortController();
  abort.abort();
  await expect(dispatchDesignTool(request, abort.signal, {} as never)).rejects.toThrow();
});
