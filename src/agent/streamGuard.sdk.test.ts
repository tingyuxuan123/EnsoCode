import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type Provider,
} from '@earendil-works/pi-ai';
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installStreamGuard } from './streamGuard';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function fixture(mode: 'idle' | 'loop' | 'trickle' = 'idle') {
  const root = mkdtempSync(path.join(tmpdir(), 'enso-stream-guard-sdk-'));
  let session: AgentSession | undefined;
  cleanups.push(() => {
    session?.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  runtime.registerProvider('stream-guard-fixture', {
    api: 'openai-completions',
    apiKey: 'fixture-not-a-real-key',
    baseUrl: 'https://fixture.invalid',
    models: [
      {
        id: 'model',
        name: 'Fixture model',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 8192,
      },
    ],
  });
  const provider = runtime.getProvider('stream-guard-fixture');
  const model = runtime.getModel('stream-guard-fixture', 'model');
  if (!provider || !model) throw new Error('Missing fixture provider/model');
  const signals: AbortSignal[] = [];
  const started = Promise.withResolvers<void>();
  const fakeStream: Provider['streamSimple'] = (_model, _context, options) => {
    if (options?.signal) signals.push(options.signal);
    const input = createAssistantMessageEventStream();
    if (mode === 'trickle') {
      const timer = setInterval(() => {
        input.push({
          type: 'toolcall_delta',
          contentIndex: 0,
          delta: '{}',
          partial: {
            role: 'assistant',
            api: model.api,
            provider: model.provider,
            model: model.id,
            content: [],
            stopReason: 'pending',
            timestamp: Date.now(),
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          },
        });
      }, 60_000);
      options?.signal?.addEventListener('abort', () => clearInterval(timer), { once: true });
      cleanups.push(() => clearInterval(timer));
    }
    if (mode === 'loop') {
      const text =
        'The model is repeating the same explanation without making any further progress. '.repeat(
          80
        );
      const partial: AssistantMessage = {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [{ type: 'text', text }],
        stopReason: 'pending',
        timestamp: Date.now(),
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      input.push({ type: 'start', partial });
      input.push({ type: 'text_delta', contentIndex: 0, delta: text, partial });
    }
    // Deliberately ignores abort and never provides result(). The guard owns liveness.
    started.resolve();
    return input;
  };
  const register = () =>
    runtime.registerNativeProvider({
      ...provider,
      streamSimple: fakeStream,
      stream: fakeStream as Provider['stream'],
    });
  register();
  installStreamGuard(runtime, {
    ...(mode === 'trickle' ? {} : { idleTimeoutMs: 20 }),
    onStall: vi.fn(),
  });
  // Provider replacement/refresh must not silently remove the runtime-level wrapper.
  register();
  const settingsManager = SettingsManager.inMemory({
    retry: { enabled: true, maxRetries: 2, baseDelayMs: 1, maxAgentDelayMs: 2 },
    compaction: { enabled: false },
  });
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: 'Isolated guard integration fixture.',
  });
  await loader.reload();
  ({ session } = await createAgentSession({
    cwd: root,
    agentDir: root,
    modelRuntime: runtime,
    model,
    thinkingLevel: 'off',
    resourceLoader: loader,
    settingsManager,
    sessionManager: SessionManager.inMemory(root),
    noTools: 'all',
  }));
  const events: string[] = [];
  session.subscribe((event) => events.push(event.type));
  return { runtime, session, model, signals, started: started.promise, events };
}

describe('real Pi SDK stream guard wiring', () => {
  it('持续涓流触达总寿命后沿用 SDK 有限重试预算，最终回合只结算一次', async () => {
    const h = await fixture('trickle');
    vi.useFakeTimers();
    const prompt = h.session.prompt('fixture task');
    await h.started;
    await vi.advanceTimersByTimeAsync(3 * 3_600_000 + 100);
    expect(h.signals).toHaveLength(3);
    expect(h.signals.every((signal) => signal.aborted)).toBe(true);
    await prompt;
    expect(h.events.filter((type) => type === 'auto_retry_start')).toHaveLength(2);
    expect(h.events.filter((type) => type === 'agent_settled')).toHaveLength(1);
    expect((h.session.messages.at(-1) as AssistantMessage).errorMessage).toMatch(/timed out/i);
    expect(h.session.isIdle).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('idle timeout uses the existing finite autoRetry budget and settles exactly once', async () => {
    const h = await fixture();
    vi.useFakeTimers();
    const prompt = h.session.prompt('fixture task');
    await h.started;
    await vi.advanceTimersByTimeAsync(100);
    await prompt;
    expect(h.signals).toHaveLength(3);
    expect(h.signals.every((signal) => signal.aborted)).toBe(true);
    expect(h.events.filter((type) => type === 'auto_retry_start')).toHaveLength(2);
    expect(h.events.filter((type) => type === 'agent_settled')).toHaveLength(1);
    const last = h.session.messages.at(-1) as AssistantMessage;
    expect(last.stopReason).toBe('error');
    expect(last.errorMessage).toMatch(/timed out/i);
    expect(h.session.isIdle).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('session.abort() interrupts an uncooperative provider without retrying', async () => {
    const h = await fixture();
    vi.useFakeTimers();
    const prompt = h.session.prompt('fixture task');
    await h.started;
    await h.session.abort();
    await prompt;
    expect(h.signals).toHaveLength(1);
    expect(h.signals[0].aborted).toBe(true);
    expect(h.events.filter((type) => type === 'auto_retry_start')).toHaveLength(0);
    expect(h.events.filter((type) => type === 'agent_settled')).toHaveLength(1);
    expect((h.session.messages.at(-1) as AssistantMessage).stopReason).toBe('aborted');
    expect(h.session.isIdle).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('exact repetition errors do not autoRetry in the real session', async () => {
    const h = await fixture('loop');
    await h.session.prompt('fixture task');
    expect(h.signals).toHaveLength(1);
    expect(h.events.filter((type) => type === 'auto_retry_start')).toHaveLength(0);
    expect(h.events.filter((type) => type === 'agent_settled')).toHaveLength(1);
    expect((h.session.messages.at(-1) as AssistantMessage).errorMessage).toMatch(
      /exact repetition/i
    );
  });

  it('direct complete and pi-virtual completeSimple guard only the actual provider request', async () => {
    const h = await fixture();
    h.runtime.registerVirtualModel({
      provider: 'guard-router',
      id: 'auto',
      name: 'Fixture router',
      route: () => ({ model: h.model, thinkingLevel: 'off' }),
    });
    const virtual = h.runtime.getModel('guard-router', 'auto');
    if (!virtual) throw new Error('Missing virtual fixture');
    vi.useFakeTimers();
    const direct = h.runtime.complete(h.model, { messages: [] });
    const routed = h.runtime.completeSimple(virtual, { messages: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.signals).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(6);
    await vi.advanceTimersByTimeAsync(20);
    expect((await direct).errorMessage).toMatch(/timed out/i);
    expect((await routed).errorMessage).toMatch(/timed out/i);
    expect(vi.getTimerCount()).toBe(0);
  });
});
