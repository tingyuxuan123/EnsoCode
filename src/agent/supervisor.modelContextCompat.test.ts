import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Context, Model } from '@earendil-works/pi-ai';
import { hasApi, InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { SpawnModelConfig } from '@shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ContextMessage, sanitizeContextMessages } from './imageContext';
import { initializeWorkerRuntime, resolveBaseModel } from './supervisor';
import { registerVirtualModel } from './virtualModels';

vi.mock('./cursor/loadProvider', () => ({
  CURSOR_PROVIDER_ID: 'cursor',
  loadCursorProvider: vi.fn().mockResolvedValue(undefined),
}));

const grokConfig: SpawnModelConfig = {
  api: 'openai-responses',
  baseUrl: 'https://grok.example.test/v1',
  apiKey: 'fixture-only',
  modelId: 'grok-4.7',
  settingsProviderId: 'fixture-grok',
  contextWindow: 256_000,
  maxTokens: 32_000,
};
const kimiConfig: SpawnModelConfig = {
  ...grokConfig,
  baseUrl: 'https://kimi.example.test/v1',
  modelId: 'kimi-k2-thinking',
  settingsProviderId: 'fixture-kimi',
};
const callId = 'call_fixture';
const reasoningId = 'rs_fixture';

function history(model: Model<'openai-responses'>): ContextMessage[] {
  return [
    { role: 'user', content: [{ type: 'text', text: 'read a.ts' }], timestamp: 1 },
    {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: 'read first',
          thinkingSignature: JSON.stringify({ id: reasoningId, type: 'reasoning', summary: [] }),
        },
        { type: 'toolCall', id: callId, name: 'read', arguments: { path: 'a.ts' } },
      ],
      api: model.api,
      model: model.id,
      provider: model.provider,
      usage: {
        input: 10,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 12,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'toolUse',
      timestamp: 2,
    },
    {
      role: 'toolResult',
      toolCallId: callId,
      toolName: 'read',
      content: [{ type: 'text', text: 'const a = 1;' }],
      timestamp: 3,
      isError: false,
    },
  ];
}

type WireItem = {
  type: string;
  id?: string;
  call_id?: string;
  role?: string;
  content?: Array<{ type: string; text?: string }>;
};
type WireBody = { model: string; input: WireItem[] };

describe('worker 的物理模型出口兼容（真实 Pi Responses 序列化）', () => {
  let runtime: ModelRuntime;
  let tempDir: string;
  let requests: WireBody[];

  beforeEach(async () => {
    requests = [];
    tempDir = mkdtempSync(path.join(tmpdir(), 'enso-model-context-'));
    vi.stubEnv('PI_OFFLINE', '1');
    vi.stubGlobal('fetch', (async (input, init) => {
      const request = new Request(input, init);
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/responses')) {
        throw new Error(`Unexpected fixture request: ${request.method} ${request.url}`);
      }
      requests.push((await request.json()) as WireBody);
      // 请求已经被真实 serializer 捕获，无需模拟后续流事件。
      return Response.json({ error: { message: 'fixture transport stopped' } }, { status: 400 });
    }) satisfies typeof fetch);
    runtime = await initializeWorkerRuntime(
      await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsStore: new InMemoryModelsStore(),
        authPath: path.join(tempDir, 'auth.json'),
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const cases = [
    { config: kimiConfig, fast: grokConfig, texts: [] },
    { config: grokConfig, fast: kimiConfig, texts: [''] },
  ].flatMap((test) =>
    (['stream', 'streamSimple', 'complete', 'completeSimple', 'virtual'] as const).map(
      (surface) => ({ ...test, surface })
    )
  );

  it.each(cases)('$surface → $config.modelId 只在 Grok 补空文本并保持工具配对', async (test) => {
    const physical = resolveBaseModel(runtime, test.config);
    if (!hasApi(physical, 'openai-responses')) throw new Error('Expected Responses model');
    const original = history(physical);
    const snapshot = structuredClone(original);
    const messages = test.config === grokConfig ? original : sanitizeContextMessages(original);
    const context: Context = { messages: messages as unknown as Context['messages'] };
    let error: string | undefined;
    if (test.surface === 'stream' || test.surface === 'streamSimple') {
      error = (await runtime[test.surface](physical, context).result()).errorMessage;
    } else if (test.surface === 'complete' || test.surface === 'completeSimple') {
      error = (await runtime[test.surface](physical, context)).errorMessage;
    } else {
      const routed = await registerVirtualModel(
        runtime,
        {
          ...test.config,
          modelId: 'fixture-virtual',
          settingsProviderId: 'enso-virtual',
          virtual: {
            name: 'fixture-virtual',
            primary: test.fast,
            fast: test.config,
            fallbacks: [],
          },
        },
        async (config) => resolveBaseModel(runtime, config)
      );
      error = (await runtime.streamSimple(routed.model, context).result()).errorMessage;
    }
    expect(requests, error).toHaveLength(1);
    const [request] = requests;
    expect(request.model).toBe(test.config.modelId);
    const texts = request.input
      .filter((item) => item.type === 'message' && item.role === 'assistant')
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === 'output_text')
      .map((part) => part.text);
    expect(texts).toEqual(test.texts);
    expect(
      request.input.filter((item) => item.type === 'reasoning').map((item) => item.id)
    ).toEqual([reasoningId]);
    expect(
      request.input.filter((item) => item.call_id).map((item) => [item.type, item.call_id])
    ).toEqual([
      ['function_call', callId],
      ['function_call_output', callId],
    ]);
    expect(original).toEqual(snapshot);
  });
});
