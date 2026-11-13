import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  InMemoryModelsStore,
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
import {
  OUTPUT_LIMIT_RECOVERY_ATTEMPTS,
  OUTPUT_LIMIT_RESUME,
  OUTPUT_LIMIT_SPLIT,
  outputLimitRecovery,
  outputLimitRecoveryExtension,
} from './outputLimitRecovery';
import { silentTurnRecoveryExtension } from './sessionAdapter';

const base = {
  outcome: 'completed',
  stopReason: 'length',
  outputTokens: 32,
  modelMaxTokens: 32,
  hasToolCalls: false,
  attempts: 0,
};

describe('outputLimitRecovery policy', () => {
  it('达到模型输出上限后纯文本续写，截断的工具调用改为拆分提示', () => {
    expect(outputLimitRecovery(base)).toBe('resume');
    expect(outputLimitRecovery({ ...base, hasToolCalls: true })).toBe('split');
  });
  it.each([
    { outcome: 'aborted' },
    { outcome: 'error' },
    { stopReason: 'stop' },
    { attempts: 3 },
    { outputTokens: 10 },
    { outputTokens: undefined },
    { modelMaxTokens: undefined },
    { outputTokens: Number.NaN },
    { modelMaxTokens: Number.POSITIVE_INFINITY },
    { modelMaxTokens: 0 },
  ])('取消、失败、预算耗尽或用量不明时不自动请求 %#', (patch) => {
    expect(outputLimitRecovery({ ...base, ...patch })).toBeUndefined();
  });
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

async function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'enso-output-limit-'));
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
  runtime.registerProvider('output-limit-fixture', {
    api: 'openai-completions',
    apiKey: 'fixture',
    baseUrl: 'https://fixture.invalid',
    models: [
      {
        id: 'fixture',
        name: 'fixture',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 32,
      },
    ],
  });
  const model = runtime.getModel('output-limit-fixture', 'fixture');
  const provider = runtime.getProvider('output-limit-fixture');
  if (!model || !provider) throw new Error('Missing fixture model');
  const requests: string[] = [];
  let plan: (request: number) => AssistantMessage = () => reply('part', 'length');
  const reply = (
    text: string,
    stopReason: AssistantMessage['stopReason'],
    tool = false
  ): AssistantMessage => ({
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: tool
      ? [{ type: 'toolCall', id: 'truncated', name: 'dangerous', arguments: { text } }]
      : [{ type: 'text', text }],
    timestamp: Date.now(),
    stopReason,
    usage: {
      input: 1,
      output: 32,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 33,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  const execute = vi.fn(async () => ({
    content: [{ type: 'text' as const, text: 'ran' }],
    details: undefined,
  }));
  runtime.registerNativeProvider({
    ...provider,
    streamSimple: (_model, context) => {
      requests.push(JSON.stringify(context.messages));
      const stream = createAssistantMessageEventStream();
      // 错误实现也必须在测试里有硬界限，不能让连续工具拒绝耗尽测试进程。
      const message =
        requests.length > 8 ? reply('fixture request bound', 'stop') : plan(requests.length);
      if (message.stopReason === 'error' || message.stopReason === 'aborted')
        stream.push({ type: 'error', reason: message.stopReason, error: message });
      else
        stream.push({
          type: 'done',
          reason: message.stopReason as 'stop' | 'length' | 'toolUse',
          message,
        });
      return stream;
    },
  });
  const manager = SessionManager.inMemory(root);
  const settingsManager = SettingsManager.inMemory({
    retry: { enabled: false },
    compaction: { enabled: false },
  });
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noContextFiles: true,
    noPromptTemplates: true,
    systemPrompt: 'Output recovery fixture',
    extensionFactories: [outputLimitRecoveryExtension, silentTurnRecoveryExtension(() => {})],
  });
  await loader.reload();
  ({ session } = await createAgentSession({
    cwd: root,
    agentDir: root,
    modelRuntime: runtime,
    model,
    sessionManager: manager,
    settingsManager,
    resourceLoader: loader,
    noTools: 'builtin',
    customTools: [
      {
        name: 'dangerous',
        label: 'dangerous',
        description: 'fixture',
        parameters: { type: 'object', properties: {} } as never,
        execute,
      },
    ],
  }));
  const events: string[] = [];
  session.subscribe((event) => events.push(event.type));
  return {
    session,
    manager,
    requests,
    events,
    execute,
    reply,
    plan: (next: typeof plan) => {
      plan = next;
    },
  };
}

describe('real Pi SDK output recovery', () => {
  it('最多续写三次，保留前文且最后只结算一次；下一次用户请求重置预算', async () => {
    const h = await fixture();
    h.plan((n) => h.reply(`part-${n}`, 'length'));
    await h.session.prompt('Write a long response.');
    expect(h.requests).toHaveLength(1 + OUTPUT_LIMIT_RECOVERY_ATTEMPTS);
    expect(h.requests[1]).toContain('part-1');
    expect(h.requests[1]).toContain(OUTPUT_LIMIT_RESUME);
    expect(h.events.filter((event) => event === 'agent_settled')).toHaveLength(1);
    expect(h.manager.getBranch().filter((entry) => entry.type === 'custom_message')).toHaveLength(
      3
    );
    await h.session.prompt('A new request.');
    expect(h.requests).toHaveLength(8);
  });

  it('续写正常结束后即停止，错误或用户中断不自动再请求', async () => {
    const h = await fixture();
    h.plan((n) => h.reply(`part-${n}`, n === 1 ? 'length' : 'stop'));
    await h.session.prompt('Long response');
    expect(h.requests).toHaveLength(2);
    h.plan(() => h.reply('cancelled', 'aborted'));
    await h.session.prompt('cancelled request');
    expect(h.requests).toHaveLength(3);
    h.plan(() => ({ ...h.reply('failed', 'error'), errorMessage: 'fixture failure' }));
    await h.session.prompt('failed request');
    expect(h.requests).toHaveLength(4);
  });

  it('截断工具调用绝不执行，SDK 后续请求先收到拆分指导', async () => {
    const h = await fixture();
    h.plan((n) => (n === 1 ? h.reply('huge arguments', 'length', true) : h.reply('done', 'stop')));
    await h.session.prompt('Write a huge file');
    expect(h.requests).toHaveLength(2);
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.requests.at(-1)).toContain(OUTPUT_LIMIT_SPLIT);

    // 同一工具在完整、正常的调用里确实可执行，避免靠禁用工具取得假绿色。
    h.plan((n) =>
      n === 3 ? h.reply('small arguments', 'toolUse', true) : h.reply('done', 'stop')
    );
    await h.session.prompt('Use a complete small call');
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it('只有思考的截断回复也只有三次续写，不被空回复恢复删除或追加额外请求', async () => {
    const h = await fixture();
    h.plan(() => ({
      ...h.reply('', 'length'),
      content: [{ type: 'thinking', thinking: 'partial thought' }],
    }));
    await h.session.prompt('Think through a long task');
    expect(h.requests).toHaveLength(4);
    expect(h.manager.getBranch().filter((entry) => entry.type === 'context_edit')).toHaveLength(0);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('边界钩子收到取消后不追加续写或拆分指令', async () => {
    const handlers = new Map<string, unknown>();
    const extension = outputLimitRecoveryExtension;
    if (typeof extension === 'function' || typeof extension.factory !== 'function')
      throw new Error('Missing extension factory');
    await extension.factory({
      on: (name: string, handler: unknown) => {
        handlers.set(name, handler);
      },
    } as never);
    const controller = new AbortController();
    controller.abort();
    const handler = handlers.get('turn_end') as
      | ((event: unknown, context: unknown) => unknown)
      | undefined;
    expect(handler).toBeTypeOf('function');
    const h = await fixture();
    expect(
      handler?.(
        { outcome: 'completed', message: h.reply('part', 'length'), toolResults: [], entries: [] },
        { signal: controller.signal, model: { maxTokens: 32 } }
      )
    ).toBeUndefined();
  });
});
