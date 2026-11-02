import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ child: undefined as unknown }));
vi.mock('../../agent/index?modulePath', () => ({ default: '/tmp/agent.js' }));
vi.mock('electron', async (original) => {
  const actual = await original<Record<string, unknown>>();
  return {
    ...actual,
    app: { ...(actual.app as object), getAppPath: () => process.cwd() },
    utilityProcess: { fork: () => mocks.child },
  };
});

import { completeText, startAgentWorker, stopAgentWorker } from './agentHost';

describe('completeText cancellation', () => {
  let child: EventEmitter & {
    postMessage: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
  };
  const input = {
    systemPrompt: 'test',
    userText: 'test',
    candidates: [
      {
        api: 'openai-completions' as const,
        baseUrl: 'https://fixture.invalid',
        apiKey: 'fixture',
        modelId: 'm',
        settingsProviderId: 'fixture',
      },
    ],
    timeoutMs: 20,
  };
  beforeEach(() => {
    vi.useFakeTimers();
    child = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn() });
    mocks.child = child;
    startAgentWorker();
    child.emit('spawn');
    child.postMessage.mockClear();
  });
  afterEach(() => {
    child.emit('exit');
    stopAgentWorker();
    vi.useRealTimers();
  });

  it('已取消不发送，请求中取消发abort且signal不跨worker，迟到结果不覆盖', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(completeText({ ...input, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(child.postMessage).not.toHaveBeenCalled();
    const next = new AbortController();
    const request = completeText({ ...input, requestId: 'completion-cancel', signal: next.signal });
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(child.postMessage.mock.calls[0][0]).not.toHaveProperty('signal');
    next.abort();
    await rejected;
    expect(child.postMessage).toHaveBeenCalledWith({
      type: 'abort-complete-text',
      requestId: 'completion-cancel',
    });
    child.emit('message', { type: 'text-completed', requestId: 'completion-cancel', text: 'late' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('兜底超时也终止worker请求，正常完成清除abort监听和timer', async () => {
    const request = completeText({ ...input, requestId: 'timeout' });
    const rejected = expect(request).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(5020);
    await rejected;
    expect(child.postMessage).toHaveBeenCalledWith({
      type: 'abort-complete-text',
      requestId: 'timeout',
    });
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const done = completeText({ ...input, requestId: 'done', signal: controller.signal });
    child.emit('message', { type: 'text-completed', requestId: 'done', text: 'ok' });
    await expect(done).resolves.toBe('ok');
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
