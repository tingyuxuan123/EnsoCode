import {
  type Context,
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import { installStableToolOrder, stableToolOrder } from './toolOrder';

const tool = (name: string): NonNullable<Context['tools']>[number] => ({
  name,
  description: name,
  parameters: { type: 'object', properties: {} },
});
const names = (context: Context) => context.tools?.map((entry) => entry.name);

describe('stableToolOrder', () => {
  it('同一工具集合不受 MCP 注册先后影响，按名称序列化', () => {
    const first = stableToolOrder({
      messages: [],
      tools: [tool('read'), tool('mcp_b'), tool('mcp_a')],
    });
    const second = stableToolOrder({
      messages: [],
      tools: [tool('mcp_a'), tool('read'), tool('mcp_b')],
    });
    expect(names(first)).toEqual(['mcp_a', 'mcp_b', 'read']);
    expect(names(second)).toEqual(names(first));
  });

  it('只复制无序工具数组，不改变原上下文、schema 或消息引用', () => {
    const context: Context = {
      systemPrompt: 'original',
      messages: [],
      tools: [tool('z'), tool('a')],
    };
    const sorted = stableToolOrder(context);
    expect(names(context)).toEqual(['z', 'a']);
    expect(sorted).not.toBe(context);
    expect(sorted.messages).toBe(context.messages);
    expect(sorted.systemPrompt).toBe(context.systemPrompt);
    expect(sorted.tools?.[0]).toBe(context.tools?.[1]);
  });

  it.each([undefined, [], [tool('a')], [tool('a'), tool('z')]])(
    '已有序或无工具不复制上下文 %#',
    (tools) => {
      const context: Context = { messages: [], ...(tools ? { tools } : {}) };
      expect(stableToolOrder(context)).toBe(context);
    }
  );
});

describe('installStableToolOrder', () => {
  it('两个 runtime 出口都排序，保持绑定、选项和返回流不变且重复安装幂等', () => {
    const result = createAssistantMessageEventStream();
    const seen: Context[] = [];
    const invoke = vi.fn(function (this: unknown, _model, context: Context, _options) {
      expect(this).toBe(runtime);
      seen.push(context);
      return result;
    });
    const runtime = { stream: invoke, streamSimple: invoke };
    installStableToolOrder(runtime as unknown as ModelRuntime);
    const installed = runtime.stream;
    installStableToolOrder(runtime as unknown as ModelRuntime);
    expect(runtime.stream).toBe(installed);
    const context: Context = { messages: [], tools: [tool('z'), tool('a')] };
    const options = { signal: new AbortController().signal, maxTokens: 32 };
    expect(runtime.stream({}, context, options)).toBe(result);
    expect(runtime.streamSimple({}, context, options)).toBe(result);
    expect(seen.map(names)).toEqual([
      ['a', 'z'],
      ['a', 'z'],
    ]);
    expect(
      invoke.mock.calls.every(
        (call) => call[2].signal === options.signal && call[2].maxTokens === options.maxTokens
      )
    ).toBe(true);
    expect(names(context)).toEqual(['z', 'a']);
  });

  it('出口后来增加或被替换时可重新安装，不重复包装其它出口', () => {
    const runtime: Partial<Pick<ModelRuntime, 'stream' | 'streamSimple'>> = {};
    installStableToolOrder(runtime as ModelRuntime);
    runtime.streamSimple = vi.fn(() => createAssistantMessageEventStream());
    installStableToolOrder(runtime as ModelRuntime);
    const simple = runtime.streamSimple;
    const replacement = vi.fn(() => createAssistantMessageEventStream());
    runtime.stream = replacement;
    installStableToolOrder(runtime as ModelRuntime);
    expect(runtime.streamSimple).toBe(simple);
    expect(runtime.stream).not.toBe(replacement);
  });
});

it.each(['openai-responses', 'anthropic-messages'] as const)(
  '%s 的真实 SDK 出口在转换 transcript 后仍排序，调用方 payload hook 不被丢弃',
  async (api) => {
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsStore: new InMemoryModelsStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    runtime.registerProvider('order-fixture', {
      api,
      apiKey: 'fixture',
      baseUrl: 'https://fixture.invalid/v1',
      models: [
        {
          id: 'fixture',
          name: 'fixture',
          input: ['text'],
          reasoning: false,
          contextWindow: 128_000,
          maxTokens: 128,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
    const model = runtime.getModel('order-fixture', 'fixture');
    if (!model) throw new Error('Missing fixture model');
    installStableToolOrder(runtime);
    const payloads: Array<{ tools: Array<{ name: string }> }> = [];
    const onPayload = vi.fn((payload: unknown) => payload);
    const messages: Context['messages'] = [
      { role: 'system', content: 'rules', timestamp: 1, toolsAdded: [tool('z')] },
      { role: 'system', content: '', timestamp: 2, toolsAdded: [tool('a')] },
      { role: 'user', content: 'task', timestamp: 3 },
    ];
    await runtime.completeSimple(
      model,
      { messages },
      {
        onPayload,
        maxRetries: 0,
        fetch: async (_url, init) => {
          payloads.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify({ error: { message: 'fixture end' } }), {
            status: 400,
          });
        },
      }
    );
    expect(onPayload).toHaveBeenCalledOnce();
    expect(payloads[0]?.tools.map((entry) => entry.name)).toEqual(['a', 'z']);
    const first = messages[0];
    expect(first.role === 'system' && first.toolsAdded?.[0].name).toBe('z');
  }
);
