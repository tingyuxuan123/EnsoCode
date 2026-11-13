import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  type Model,
} from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findRepetitionCycle,
  guardStream,
  installStreamGuard,
  LOCAL_STREAM_IDLE_TIMEOUT_MS,
  STREAM_IDLE_TIMEOUT_MS,
  STREAM_STALL_LOG_MS,
  type StreamGuardOptions,
  type StreamMethod,
} from './streamGuard';

const model: Model<Api> = {
  id: 'guard-fixture',
  name: 'Guard fixture',
  provider: 'guard-fixture',
  api: 'openai-completions',
  baseUrl: 'https://fixture.invalid/v1',
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 16_000,
};

function message(content: AssistantMessage['content'] = []): AssistantMessage {
  return {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content,
    stopReason: 'pending',
    usage: {
      input: 7,
      output: 8,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp: Date.now(),
  };
}

// Not just repeated syntax: a long natural-language paragraph, with a non-periodic unit.
const prose = Array.from(
  { length: 12 },
  (_, i) => `Observation ${i}: the request is still being reconsidered without making progress. `
).join('');

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function harness(guard: StreamGuardOptions = {}, requestModel = model) {
  const input = createAssistantMessageEventStream();
  let signal: AbortSignal | undefined;
  const inner = vi.fn<StreamMethod>((_model, _context, options) => {
    signal = options?.signal;
    return input;
  });
  const caller = new AbortController();
  const remove = vi.spyOn(caller.signal, 'removeEventListener');
  const output = guardStream(inner, guard)(
    requestModel,
    { messages: [] },
    { signal: caller.signal }
  );
  const events: AssistantMessageEvent[] = [];
  const consumed = (async () => {
    for await (const event of output) events.push(event);
  })();
  return { input, output, events, consumed, inner, caller, remove, signal: () => signal };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('exact repetition detector', () => {
  it('detects six complete long prose periods in the bounded tail', () => {
    const cycle = findRepetitionCycle(`unrelated prefix ${prose.repeat(6)}`);
    expect(cycle).toEqual({ period: prose.length, span: prose.length * 6 });
    expect(findRepetitionCycle('unique prefix '.repeat(2000) + prose.repeat(6))?.period).toBe(
      prose.length
    );
  });

  it('does not flag short text, fewer than six complete cycles or a stale repeated prefix', () => {
    expect(findRepetitionCycle('hello '.repeat(100))).toBeUndefined();
    expect(findRepetitionCycle(prose.repeat(5) + prose.slice(0, -1))).toBeUndefined();
    const unique = Array.from({ length: 2000 }, (_, i) => `item ${i}: result\n`).join('');
    expect(findRepetitionCycle(prose.repeat(6) + unique)).toBeUndefined();
  });

  it.each([
    Array.from({ length: 250 }, (_, i) => `export const field${i} = { enabled: true };\n`).join(''),
    Array.from({ length: 350 }, (_, i) => `| row ${i} | pending | pending |\n`).join(''),
  ])('does not flag repetitive code/table formatting (%#)', (text) => {
    expect(text.length).toBeGreaterThan(4000);
    expect(findRepetitionCycle(text)).toBeUndefined();
  });
});

describe('stream guard lifecycle', () => {
  it.each(['https://fixture.invalid/v1', 'http://localhost:1234/v1'])(
    '持续涓流也在 60 分钟终止，localhost 网关不豁免：%s',
    async (baseUrl) => {
      const h = harness({ onStall: vi.fn() }, { ...model, baseUrl });
      const partial = message([{ type: 'text', text: 'work so far' }]);
      h.input.push({ type: 'start', partial });
      for (let minute = 0; minute < 60; minute++) {
        await vi.advanceTimersByTimeAsync(59_999);
        expect(h.signal()?.aborted).toBe(false);
        h.input.push({ type: 'toolcall_delta', contentIndex: 1, delta: '{}', partial });
        await vi.advanceTimersByTimeAsync(1);
      }
      expect(h.signal()?.aborted).toBe(true);
      const result = await h.output.result();
      expect(result.stopReason).toBe('error');
      expect(result.errorMessage).toMatch(/timed out.*60 minutes/i);
      partial.content = [{ type: 'text', text: 'late mutation' }];
      h.input.push({ type: 'done', reason: 'stop', message: { ...partial, stopReason: 'stop' } });
      await h.consumed;
      expect(result.content).toEqual([{ type: 'text', text: 'work so far' }]);
      expect(h.events.filter((event) => event.type === 'error')).toHaveLength(1);
      expect(h.remove).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('权威标记的本地推理不受总寿命限制，仍可由用户取消', async () => {
    const h = harness({ isLocalModel: () => true, onStall: vi.fn() });
    for (let minute = 0; minute < 65; minute++) {
      h.input.push({ type: 'toolcall_delta', contentIndex: 0, delta: '{}', partial: message() });
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(h.signal()?.aborted).toBe(false);
    h.caller.abort('user cancellation');
    expect((await h.output.result()).stopReason).toBe('aborted');
    await h.consumed;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not dispatch inner when the caller was already aborted', async () => {
    const caller = new AbortController();
    const reason = { cause: 'user cancelled' };
    caller.abort(reason);
    const inner = vi.fn<StreamMethod>(() => createAssistantMessageEventStream());
    const output = guardStream(inner)(model, { messages: [] }, { signal: caller.signal });
    expect(inner).not.toHaveBeenCalled();
    expect((await output.result()).stopReason).toBe('aborted');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancel(reason) immediately settles output and forwards the exact reason even if inner ignores it', async () => {
    const h = harness();
    const partial = message([{ type: 'text', text: 'work so far' }]);
    h.input.push({ type: 'start', partial });
    await flush();
    const reason = new Error('cancel from the caller');
    h.caller.abort(reason);
    expect(h.signal()?.reason).toBe(reason);
    const result = await h.output.result();
    expect(result.stopReason).toBe('aborted');
    expect(result.content).toEqual(partial.content);
    expect(result.errorMessage).not.toMatch(/timed out/i);
    await h.consumed;
    expect(h.events.filter((event) => event.type === 'error')).toHaveLength(1);
    expect(h.remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('timeout emits one retryable error, snapshots partial and drops late inner events', async () => {
    const h = harness({ onStall: vi.fn() });
    const partial = message([{ type: 'text', text: 'in progress' }]);
    h.input.push({ type: 'start', partial });
    await flush();
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS);
    const result = await h.output.result();
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toMatch(/timed out/i);
    expect(h.signal()?.aborted).toBe(true);
    expect(result.usage.totalTokens).toBe(15);
    partial.content = [{ type: 'text', text: 'late mutation' }];
    partial.stopReason = 'stop';
    h.input.push({ type: 'text_delta', contentIndex: 0, delta: 'late', partial });
    h.input.push({ type: 'done', reason: 'stop', message: partial });
    await h.consumed;
    expect(result.content).toEqual([{ type: 'text', text: 'in progress' }]);
    expect(h.events.map((event) => event.type)).toEqual(['start', 'error']);
    expect(h.remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caller cancellation wins over a synchronous inner abort error and cleans up nested mutable state', async () => {
    const h = harness();
    const tool = {
      type: 'toolCall' as const,
      id: 'call',
      name: 'write',
      arguments: { nested: { text: 'before' } },
    };
    const partial = message([tool]);
    h.input.push({ type: 'start', partial });
    h.signal()?.addEventListener('abort', () => {
      h.input.push({
        type: 'error',
        reason: 'error',
        error: { ...partial, stopReason: 'error', errorMessage: 'timed out' },
      });
    });
    await flush();
    h.caller.abort('caller reason');
    const final = await h.output.result();
    tool.arguments.nested.text = 'late';
    partial.usage.output = 9000;
    expect(final.stopReason).toBe('aborted');
    expect(final.content[0]).toEqual({ ...tool, arguments: { nested: { text: 'before' } } });
    expect(final.usage.output).toBe(8);
    await h.consumed;
    expect(h.events.map((event) => event.type)).toEqual(['start', 'error']);
    expect(h.signal()?.reason).toBe('caller reason');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not concatenate independent content blocks into a false repetition', async () => {
    const h = harness();
    const partial = message(Array.from({ length: 6 }, () => ({ type: 'text', text: prose })));
    for (let index = 0; index < 6; index++) {
      h.input.push({ type: 'text_delta', contentIndex: index, delta: prose, partial });
      h.input.push({ type: 'text_end', contentIndex: index, content: prose, partial });
    }
    partial.stopReason = 'stop';
    h.input.push({ type: 'done', reason: 'stop', message: partial });
    expect(await h.output.result()).toBe(partial);
    await h.consumed;
  });

  it('forwards every content event and opaque signatures without projecting or filtering fields', async () => {
    const h = harness();
    const toolCall = {
      type: 'toolCall' as const,
      id: 'id',
      name: 'tool',
      arguments: {},
      thoughtSignature: 'tool-signature',
    };
    const partial = message([
      { type: 'text', text: 'text', textSignature: 'text-signature' },
      {
        type: 'thinking',
        thinking: 'thought',
        thinkingSignature: 'thinking-signature',
        redacted: true,
      },
      toolCall,
    ]);
    const events: AssistantMessageEvent[] = [
      { type: 'start', partial },
      { type: 'text_start', contentIndex: 0, partial },
      { type: 'text_delta', contentIndex: 0, delta: 'text', partial },
      { type: 'text_end', contentIndex: 0, content: 'text', partial },
      { type: 'thinking_start', contentIndex: 1, partial },
      { type: 'thinking_delta', contentIndex: 1, delta: 'thought', partial },
      { type: 'thinking_end', contentIndex: 1, content: 'thought', partial },
      { type: 'toolcall_start', contentIndex: 2, partial },
      { type: 'toolcall_delta', contentIndex: 2, delta: '{}', partial },
      { type: 'toolcall_end', contentIndex: 2, toolCall, partial },
      { type: 'done', reason: 'stop', message: { ...partial, stopReason: 'stop' } },
    ];
    for (const event of events) h.input.push(event);
    await h.output.result();
    await h.consumed;
    for (const [index, event] of h.events.entries()) expect(event).toBe(events[index]);
  });

  it('logs a stall once per silent interval and a throwing observer does not own liveness', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness();
    await vi.advanceTimersByTimeAsync(STREAM_STALL_LOG_MS * 2);
    expect(warn).toHaveBeenCalledTimes(1);
    h.caller.abort();
    await h.consumed;
    const noisy = harness({
      onStall: () => {
        throw new Error('observer failed');
      },
    });
    await vi.advanceTimersByTimeAsync(STREAM_STALL_LOG_MS);
    expect(noisy.signal()?.aborted).toBe(false);
    noisy.caller.abort();
    await noisy.consumed;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'invalid injected idle budget %s falls back to remote default',
    async (idleTimeoutMs) => {
      const h = harness({ idleTimeoutMs, onStall: vi.fn() });
      await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS - 1);
      expect(h.signal()?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((await h.output.result()).errorMessage).toMatch(/timed out/i);
      await h.consumed;
    }
  );

  it('90s stalls only log; every event refreshes both idle timers rather than a total deadline', async () => {
    const onStall = vi.fn();
    const h = harness({ onStall });
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(STREAM_STALL_LOG_MS);
      expect(onStall).toHaveBeenCalledTimes(i + 1);
      expect(h.signal()?.aborted).toBe(false);
      h.input.push({ type: 'toolcall_delta', contentIndex: 0, delta: '{}', partial: message() });
      await flush();
    }
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS - 1);
    expect(h.signal()?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await h.output.result()).stopReason).toBe('error');
    await h.consumed;
  });

  it.each(['http://localhost:1234/v1', 'http://127.0.0.1:8080', 'http://[::1]:8000'])(
    'keeps remote default for local cloud gateways: %s',
    async (baseUrl) => {
      const h = harness({ onStall: vi.fn() }, { ...model, baseUrl });
      await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS);
      expect((await h.output.result()).stopReason).toBe('error');
      await h.consumed;
    }
  );

  it('only an explicit known-local classifier grants the 900s idle grace', async () => {
    const h = harness({ isLocalModel: (candidate) => candidate.id === model.id, onStall: vi.fn() });
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS);
    expect(h.signal()?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(LOCAL_STREAM_IDLE_TIMEOUT_MS - STREAM_IDLE_TIMEOUT_MS);
    expect((await h.output.result()).stopReason).toBe('error');
    await h.consumed;
  });

  it.each(['stop', 'length', 'toolUse', 'deferred', 'error', 'aborted'] as const)(
    'passes through normal %s terminal and all event/metadata fields, then cleans up',
    async (stopReason) => {
      const h = harness();
      const final = { ...message(), stopReason, responseId: 'response-opaque', endTurn: true };
      const start: AssistantMessageEvent = { type: 'start', partial: final };
      const terminal: AssistantMessageEvent =
        stopReason === 'error' || stopReason === 'aborted'
          ? { type: 'error', reason: stopReason, error: final }
          : { type: 'done', reason: stopReason, message: final };
      h.input.push(start);
      h.input.push(terminal);
      expect(await h.output.result()).toBe(final);
      await h.consumed;
      expect(h.events).toEqual([start, terminal]);
      expect(h.signal()?.aborted).toBe(false);
      expect(h.remove).toHaveBeenCalledWith('abort', expect.any(Function));
      h.caller.abort('after completion');
      expect(h.signal()?.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each(['text', 'thinking'] as const)(
    'stops long exact %s loops without a retryable error',
    async (kind) => {
      const h = harness();
      const text = prose.repeat(6);
      const partial = message([
        kind === 'text' ? { type: 'text', text } : { type: 'thinking', thinking: text },
      ]);
      h.input.push({
        type: kind === 'text' ? 'text_delta' : 'thinking_delta',
        contentIndex: 0,
        delta: text,
        partial,
      });
      const result = await h.output.result();
      expect(result.stopReason).toBe('error');
      expect(result.errorMessage).toMatch(/exact repetition/i);
      expect(result.errorMessage).not.toMatch(/timed out|429|5\d\d|overloaded/i);
      expect(h.signal()?.aborted).toBe(true);
      expect(result.content).toEqual([
        kind === 'text' ? { type: 'text', text: prose } : { type: 'thinking', thinking: prose },
      ]);
      expect(partial.content).not.toEqual(result.content);
      await h.consumed;
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('checks split deltas, including the final sub-step suffix at text_end', async () => {
    const h = harness();
    const text = 'abcdefghij'.repeat(400);
    const partial = message([{ type: 'text', text }]);
    for (let i = 0; i < text.length; i += 100) {
      h.input.push({ type: 'text_delta', contentIndex: 0, delta: text.slice(i, i + 100), partial });
    }
    h.input.push({ type: 'text_end', contentIndex: 0, content: text, partial });
    expect((await h.output.result()).errorMessage).toMatch(/exact repetition/i);
    await h.consumed;
  });

  it('does not inspect tool arguments or confuse a live future partial with an event-time delta', async () => {
    const h = harness();
    const toolCall = {
      type: 'toolCall' as const,
      id: 'call',
      name: 'write',
      arguments: { text: prose.repeat(6) },
    };
    const final = message([{ type: 'text', text: prose.repeat(6) }, toolCall]);
    h.input.push({
      type: 'text_delta',
      contentIndex: 0,
      delta: 'small current delta',
      partial: final,
    });
    h.input.push({
      type: 'toolcall_delta',
      contentIndex: 1,
      delta: JSON.stringify(toolCall.arguments),
      partial: final,
    });
    final.stopReason = 'toolUse';
    h.input.push({ type: 'done', reason: 'toolUse', message: final });
    expect(await h.output.result()).toBe(final);
    await h.consumed;
    expect(h.events.map((event) => event.type)).toEqual(['text_delta', 'toolcall_delta', 'done']);
  });

  it('turns a synchronous inner throw into an error stream and releases listener/timers', async () => {
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const output = guardStream(() => {
      throw new Error('setup failed');
    })(model, { messages: [] }, { signal: caller.signal });
    expect((await output.result()).errorMessage).toBe('setup failed');
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('turns an iterator throw into an error stream', async () => {
    const input = createAssistantMessageEventStream();
    input[Symbol.asyncIterator] = () => ({
      next: () => Promise.reject(new Error('iteration failed')),
    });
    const output = guardStream(() => input)(model, { messages: [] });
    expect((await output.result()).errorMessage).toBe('iteration failed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('synthesizes the terminal event when inner only calls end(final)', async () => {
    const h = harness();
    const final = { ...message(), stopReason: 'stop' as const };
    h.input.end(final);
    expect(await h.output.result()).toBe(final);
    await h.consumed;
    expect(h.events).toEqual([{ type: 'done', reason: 'stop', message: final }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['timeout', 'cancel'] as const)(
    'an empty stream with hanging result still settles on %s',
    async (action) => {
      const h = harness({ onStall: vi.fn() });
      h.input.end();
      await flush();
      if (action === 'cancel') h.caller.abort('cancel after empty stream');
      else await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS);
      expect((await h.output.result()).stopReason).toBe(action === 'cancel' ? 'aborted' : 'error');
      await h.consumed;
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('handles a rejected final result and a pending non-final result', async () => {
    for (const rejected of [true, false]) {
      const input = createAssistantMessageEventStream();
      input.result = () =>
        rejected ? Promise.reject(new Error('result failed')) : Promise.resolve(message());
      input.end();
      const output = guardStream(() => input)(model, { messages: [] });
      expect((await output.result()).stopReason).toBe('error');
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('installs once, binds runtime methods, and skips only the outer pi-virtual stream', async () => {
    let requests = 0;
    const runtime = {
      stream(this: unknown, requestModel: Model<Api>): AssistantMessageEventStream {
        expect(this).toBe(runtime);
        if (requestModel.api === 'pi-virtual') return runtime.streamSimple(model);
        requests++;
        return createAssistantMessageEventStream();
      },
      streamSimple(this: unknown, requestModel: Model<Api>): AssistantMessageEventStream {
        expect(this).toBe(runtime);
        if (requestModel.api === 'pi-virtual') return runtime.stream(model);
        requests++;
        return createAssistantMessageEventStream();
      },
    };
    installStreamGuard(runtime as unknown as ModelRuntime, { onStall: vi.fn() });
    const installed = runtime.streamSimple;
    installStreamGuard(runtime as unknown as ModelRuntime);
    expect(runtime.streamSimple).toBe(installed);
    const output = runtime.streamSimple({ ...model, api: 'pi-virtual' });
    expect(requests).toBe(1);
    expect(vi.getTimerCount()).toBe(3);
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS);
    expect((await output.result()).stopReason).toBe('error');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('already-aborted virtual requests do not dispatch even the outer router stream', async () => {
    const stream = vi.fn<StreamMethod>(() => createAssistantMessageEventStream());
    const runtime = { stream, streamSimple: stream };
    installStreamGuard(runtime as unknown as ModelRuntime);
    const caller = new AbortController();
    caller.abort('cancelled before virtual dispatch');
    const options = { signal: caller.signal };
    const virtual = { ...model, api: 'pi-virtual' };
    const output = runtime.streamSimple(virtual, { messages: [] }, options);
    expect(stream).not.toHaveBeenCalled();
    expect((await output.result()).stopReason).toBe('aborted');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('skips missing mock exits and can install them later without double-wrapping an existing exit', async () => {
    const runtime: Partial<Pick<ModelRuntime, 'stream' | 'streamSimple'>> = {};
    installStreamGuard(runtime as ModelRuntime);
    runtime.streamSimple = () => createAssistantMessageEventStream();
    installStreamGuard(runtime as ModelRuntime, { idleTimeoutMs: 20 });
    const installedSimple = runtime.streamSimple;
    runtime.stream = () => createAssistantMessageEventStream();
    installStreamGuard(runtime as ModelRuntime, { idleTimeoutMs: 20 });
    expect(runtime.streamSimple).toBe(installedSimple);
    const simple = runtime.streamSimple(model, { messages: [] });
    const full = runtime.stream(model, { messages: [] });
    expect(vi.getTimerCount()).toBe(6);
    await vi.advanceTimersByTimeAsync(20);
    expect((await simple.result()).errorMessage).toMatch(/timed out/i);
    expect((await full.result()).errorMessage).toMatch(/timed out/i);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('can still abort an incomplete adapter partial with missing usage instead of leaking timers', async () => {
    const h = harness();
    // Some adapters/test doubles provide incomplete partials. Terminal liveness cannot depend on usage.
    const partial = { content: [{ type: 'text', text: 'partial' }] } as AssistantMessage;
    h.input.push({ type: 'text_delta', contentIndex: 0, delta: 'partial', partial });
    await flush();
    h.caller.abort('caller cancellation');
    const final = await h.output.result();
    expect(final.stopReason).toBe('aborted');
    expect(final.usage.totalTokens).toBe(0);
    await h.consumed;
    expect(vi.getTimerCount()).toBe(0);
  });
});
