import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type ModelsApiStreamOptions,
  type ProviderRequestOptions,
} from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

export const STREAM_IDLE_TIMEOUT_MS = 300_000;
export const LOCAL_STREAM_IDLE_TIMEOUT_MS = 900_000;
export const STREAM_STALL_LOG_MS = 90_000;
/** 远端单次请求硬上限，不随涓流事件重置；仅权威标记的本地推理豁免。 */
export const STREAM_MAX_LIFETIME_MS = 3_600_000;

const REPETITION_WINDOW = 16_384;
const REPETITION_MIN_SPAN = 4_000;
const REPETITION_MIN_REPEATS = 6;
const REPETITION_CHECK_STEP = 1_024;

export interface RepetitionCycle {
  period: number;
  span: number;
}

export interface StreamGuardOptions {
  /** In-process injection only; no new user setting or wire protocol. */
  idleTimeoutMs?: number;
  /**
   * Only authoritative local-inference callers may opt into 900s idle and no lifetime cap.
   * Custom providers use derived enso-* identities. Neither a compatible API name
   * (including Ollama) nor localhost attests local execution rather than a cloud gateway.
   */
  isLocalModel?: (model: Model<Api>) => boolean;
  onStall?: (silentMs: number, model: Model<Api>) => void;
}

export type StreamMethod<TOptions extends ProviderRequestOptions = ProviderRequestOptions> = (
  model: Model<Api>,
  context: Context,
  options?: TOptions
) => AssistantMessageEventStream;

/** Reverse KMP finds a periodic suffix in O(window), requiring six COMPLETE periods. */
export function findRepetitionCycle(text: string): RepetitionCycle | undefined {
  const n = Math.min(text.length, REPETITION_WINDOW);
  if (n < REPETITION_MIN_SPAN) return undefined;
  const reversed = new Uint16Array(n);
  for (let i = 0; i < n; i++) reversed[i] = text.charCodeAt(text.length - 1 - i);
  const prefix = new Int32Array(n);
  for (let i = 1; i < n; i++) {
    let k = prefix[i - 1];
    while (k > 0 && reversed[i] !== reversed[k]) k = prefix[k - 1];
    if (reversed[i] === reversed[k]) k++;
    prefix[i] = k;
  }
  for (let m = n; m >= REPETITION_MIN_SPAN; m--) {
    const period = m - prefix[m - 1];
    const repeats = Math.floor(m / period);
    const span = repeats * period;
    if (repeats >= REPETITION_MIN_REPEATS && span >= REPETITION_MIN_SPAN) return { period, span };
  }
  return undefined;
}

function emptyMessage(model: Model<Api>): AssistantMessage {
  return {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [],
    timestamp: Date.now(),
    stopReason: 'pending',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

/** Provider partials remain live, including after abort: never publish one as our own terminal. */
function snapshot(message: AssistantMessage, model: Model<Api>): AssistantMessage {
  const fallback = emptyMessage(model);
  const usage = message.usage ?? fallback.usage;
  return {
    ...fallback,
    ...message,
    content: (message.content ?? []).map((block) =>
      block.type === 'toolCall'
        ? { ...block, arguments: structuredClone(block.arguments) }
        : { ...block }
    ),
    usage: { ...usage, cost: { ...usage.cost } },
  };
}

function terminal(message: AssistantMessage): AssistantMessageEvent | undefined {
  const reason = message.stopReason;
  if (reason === 'pending') return undefined;
  return reason === 'error' || reason === 'aborted'
    ? { type: 'error', reason, error: message }
    : { type: 'done', reason, message };
}

/** Guard the public stream contract, without taking over session retries or lifecycle. */
export function guardStream<TOptions extends ProviderRequestOptions>(
  inner: StreamMethod<TOptions>,
  guard: StreamGuardOptions = {}
): StreamMethod<TOptions> {
  return (model, context, options) => {
    const out = createAssistantMessageEventStream();
    const controller = new AbortController();
    const caller = options?.signal;
    // One interruptible wait, not Promise.race against a shared never-settled promise on
    // every delta (which would retain one promise reaction per event until termination).
    let interrupt: (() => void) | undefined;
    let finished = false;
    let partial: AssistantMessage | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let lifetimeTimer: ReturnType<typeof setTimeout> | undefined;
    const texts = new Map<number, { tail: string; length: number; checked: number }>();

    const clearTimers = () => {
      clearTimeout(idleTimer);
      clearTimeout(stallTimer);
      clearTimeout(lifetimeTimer);
    };
    const wait = <T>(pending: Promise<T>): Promise<T | undefined> =>
      new Promise((resolve, reject) => {
        const stop = () => resolve(undefined);
        interrupt = stop;
        pending.then(
          (value) => {
            if (interrupt === stop) interrupt = undefined;
            resolve(value);
          },
          (error: unknown) => {
            if (interrupt === stop) interrupt = undefined;
            reject(error);
          }
        );
        if (finished) stop();
      });
    const finish = (event: AssistantMessageEvent) => {
      if (finished || (event.type !== 'done' && event.type !== 'error')) return;
      finished = true;
      clearTimers();
      caller?.removeEventListener('abort', abort);
      interrupt?.();
      interrupt = undefined;
      texts.clear();
      out.push(event);
      out.end(event.type === 'done' ? event.message : event.error);
    };
    const fail = (text: string, reason: 'error' | 'aborted' = 'error', base = partial) => {
      if (finished) return;
      let safe: AssistantMessage;
      try {
        safe = snapshot(base ?? emptyMessage(model), model);
      } catch {
        // A broken adapter partial must never prevent cancellation/timeout from settling.
        safe = emptyMessage(model);
      }
      const error = {
        ...safe,
        stopReason: reason,
        errorMessage: text,
      };
      // Finish BEFORE abort: the provider's abort listener may emit synchronously.
      finish({ type: 'error', reason, error });
      controller.abort(reason === 'aborted' ? caller?.reason : new Error(text));
    };
    const abort = () => fail('Request aborted.', 'aborted');
    if (caller?.aborted) {
      abort();
      return out;
    }
    caller?.addEventListener('abort', abort, { once: true });

    const arm = (idleMs: number) => {
      clearTimeout(idleTimer);
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (finished) return;
        // Diagnostics must not turn an otherwise healthy stream into an exception.
        try {
          if (guard.onStall) guard.onStall(STREAM_STALL_LOG_MS, model);
          else
            console.warn(`[stream-guard] ${model.provider}/${model.id}: no stream events for 90s`);
        } catch {
          /* A log observer does not own stream liveness. */
        }
      }, STREAM_STALL_LOG_MS);
      idleTimer = setTimeout(
        () => fail(`LLM stream timed out: no stream events for ${idleMs / 1000}s.`),
        idleMs
      );
    };

    const checkRepetition = (event: AssistantMessageEvent): boolean => {
      if (
        event.type !== 'text_delta' &&
        event.type !== 'thinking_delta' &&
        event.type !== 'text_end' &&
        event.type !== 'thinking_end'
      )
        return false;
      const index = event.contentIndex;
      const state = texts.get(index) ?? { tail: '', length: 0, checked: 0 };
      const ending = event.type === 'text_end' || event.type === 'thinking_end';
      if (ending) {
        state.tail = event.content.slice(-REPETITION_WINDOW);
        state.length = event.content.length;
      } else {
        // Pi partial is shared live state, NOT an event-time snapshot. Only delta is authoritative here.
        state.tail = (state.tail + event.delta).slice(-REPETITION_WINDOW);
        state.length += event.delta.length;
      }
      texts.set(index, state);
      if (!ending && state.length - state.checked < REPETITION_CHECK_STEP) return false;
      state.checked = state.length;
      const cycle = findRepetitionCycle(state.tail);
      if (!cycle) return false;
      const base = snapshot(event.partial, model);
      const block = base.content[index];
      const keep = state.length - cycle.span + cycle.period;
      if (block?.type === 'text') block.text = block.text.slice(0, keep);
      else if (block?.type === 'thinking') block.thinking = block.thinking.slice(0, keep);
      fail('Model output entered an exact repetition loop; response stopped.', 'error', base);
      return true;
    };

    try {
      const local = guard.isLocalModel?.(model) === true;
      const configuredIdle = guard.idleTimeoutMs;
      const idleMs =
        typeof configuredIdle === 'number' && Number.isFinite(configuredIdle) && configuredIdle > 0
          ? configuredIdle
          : local
            ? LOCAL_STREAM_IDLE_TIMEOUT_MS
            : STREAM_IDLE_TIMEOUT_MS;
      arm(idleMs);
      if (!local) {
        lifetimeTimer = setTimeout(
          () =>
            fail(
              `LLM stream timed out: still incomplete after ${STREAM_MAX_LIFETIME_MS / 60_000} minutes, so the request was aborted.`
            ),
          STREAM_MAX_LIFETIME_MS
        );
      }
      const input = inner(model, context, { ...options, signal: controller.signal } as TOptions);
      void (async () => {
        let iterator: AsyncIterator<AssistantMessageEvent> | undefined;
        try {
          iterator = input[Symbol.asyncIterator]();
          while (!finished) {
            const next = await wait(iterator.next());
            if (finished || !next) return;
            if (next.done) break;
            const event = next.value;
            arm(idleMs);
            if ('partial' in event) partial = event.partial;
            if (checkRepetition(event)) return;
            if (event.type === 'done' || event.type === 'error') {
              finish(event);
              return;
            }
            out.push(event);
          }
          if (finished) return;
          // end(final) is legal. end() with a pending result is still bounded by idle/abort.
          const result = await wait(input.result());
          if (finished) return;
          const event = result && terminal(result);
          if (event) finish(event);
          else fail('LLM stream ended without a final response.');
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error));
        } finally {
          // Never await an uncooperative iterator's return(), just like its next()/result().
          try {
            void Promise.resolve(iterator?.return?.()).catch(() => {});
          } catch {}
        }
      })();
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    return out;
  };
}

const installed = new WeakMap<
  ModelRuntime,
  Partial<Pick<ModelRuntime, 'stream' | 'streamSimple'>>
>();

/** Public runtime exits survive provider refresh, OAuth cloning and native-provider replacement. */
export function installStreamGuard(runtime: ModelRuntime, guard: StreamGuardOptions = {}): void {
  const bound = installed.get(runtime) ?? {};
  // Narrow test doubles may omit either public exit. Record only successful installations,
  // so a later-added/replaced exit can be guarded without double-wrapping the other one.
  if (typeof runtime.stream === 'function' && runtime.stream !== bound.stream) {
    const stream = runtime.stream.bind(runtime);
    const guarded = guardStream<ModelsApiStreamOptions<Api>>(stream, guard);
    // pi-virtual recursively dispatches through this runtime to a physical model. Already
    // cancelled calls still take the early-abort path without dispatching the router at all.
    // Erase only the generic API-options association; values/fields remain untouched.
    runtime.stream = (model, context, options) =>
      model.api === 'pi-virtual' && !options?.signal?.aborted
        ? stream(model, context, options)
        : guarded(model, context, options as ModelsApiStreamOptions<Api>);
    bound.stream = runtime.stream;
    installed.set(runtime, bound);
  }
  if (typeof runtime.streamSimple === 'function' && runtime.streamSimple !== bound.streamSimple) {
    const streamSimple = runtime.streamSimple.bind(runtime);
    const guarded = guardStream(streamSimple, guard);
    runtime.streamSimple = (model, context, options) =>
      model.api === 'pi-virtual' && !options?.signal?.aborted
        ? streamSimple(model, context, options)
        : guarded(model, context, options);
    bound.streamSimple = runtime.streamSimple;
    installed.set(runtime, bound);
  }
}
