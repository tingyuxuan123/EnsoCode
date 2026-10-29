import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AssistantMessage, TranscriptContext } from '@earendil-works/pi-ai';
import { getModel } from '@earendil-works/pi-ai/compat';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import {
  createAgentSession,
  DefaultResourceLoader,
  type InlineExtension,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSessionDisplayMessages,
  continueSessionActivity,
  editLatestAssistantForRetry,
  silentTurnRecoveryExtension,
  steerActiveSession,
} from './sessionAdapter';
import { POST_TOOL_EMPTY_NUDGE, SILENT_TURN_NUDGE } from './silentTurn';

type ReplyPlan = {
  content: AssistantMessage['content'];
  stopReason?: AssistantMessage['stopReason'];
  errorMessage?: string;
};

const model = getModel('openai', 'gpt-4o-mini');
if (!model) throw new Error('Test model is not available in the bundled Pi catalog.');

const testTool: ToolDefinition = {
  name: 'adapter_test_tool',
  label: 'Adapter test tool',
  description: 'A side-effect-free tool used by the session adapter test.',
  parameters: Type.Object({}),
  execute: async () => ({ content: [{ type: 'text', text: 'tool finished' }], details: undefined }),
};

function assistant(providerModel: typeof model, plan: ReplyPlan): AssistantMessage {
  return {
    role: 'assistant',
    content: plan.content,
    api: providerModel.api,
    provider: providerModel.provider,
    model: providerModel.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: plan.stopReason ?? 'stop',
    ...(plan.errorMessage ? { errorMessage: plan.errorMessage } : {}),
    timestamp: Date.now(),
  };
}

function textOf(message: unknown): string {
  if (!message || typeof message !== 'object' || !('content' in message)) return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .flatMap((part) =>
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      part.type === 'text' &&
      'text' in part &&
      typeof part.text === 'string'
        ? [part.text]
        : []
    )
    .join('');
}

function contextText(context: TranscriptContext): string {
  return context.messages.map((message) => textOf(message)).join('\n');
}

type Harness = {
  session: Awaited<ReturnType<typeof createAgentSession>>['session'];
  manager: SessionManager;
  requests: TranscriptContext[];
  recoveryKinds: string[];
  streamStarted: Promise<void>;
  cleanup: () => void;
};

async function createHarness(
  plans: Array<ReplyPlan | 'wait-for-abort'>,
  options: { seedError?: boolean; extensions?: InlineExtension[] } = {}
): Promise<Harness> {
  const root = mkdtempSync(path.join(tmpdir(), 'enso-session-adapter-'));
  const cwd = path.join(root, 'workspace');
  const agentDir = path.join(root, 'agent');
  const sessionDir = path.join(root, 'sessions');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });

  const runtime = await ModelRuntime.create({
    authPath: path.join(agentDir, 'auth.json'),
    modelsPath: path.join(agentDir, 'models.json'),
    refreshOnCreate: false,
  });
  vi.spyOn(runtime, 'hasConfiguredAuth').mockReturnValue(true);
  const manager = SessionManager.create(cwd, sessionDir);
  if (options.seedError) {
    manager.appendMessage({
      role: 'user',
      content: [{ type: 'text', text: 'Please retry this request.' }],
      timestamp: Date.now(),
    });
    manager.appendMessage(
      assistant(model, {
        content: [{ type: 'text', text: 'old provider error response' }],
        stopReason: 'error',
        errorMessage: 'HTTP 400 invalid request',
      })
    );
  }

  const requests: TranscriptContext[] = [];
  const recoveryKinds: string[] = [];
  const streamStarted = Promise.withResolvers<void>();
  vi.spyOn(runtime, 'streamSimple').mockImplementation((requestModel, context, streamOptions) => {
    requests.push(context as TranscriptContext);
    const stream = createAssistantMessageEventStream();
    const plan = plans.shift();
    if (plan === 'wait-for-abort') {
      const emitAborted = () => {
        stream.push({
          type: 'error',
          reason: 'aborted',
          error: assistant(requestModel as typeof model, {
            content: [],
            stopReason: 'aborted',
          }),
        });
      };
      streamOptions?.signal?.addEventListener('abort', emitAborted, { once: true });
      streamStarted.resolve();
    } else {
      const message = assistant(
        requestModel as typeof model,
        plan ?? {
          content: [],
          stopReason: 'error',
          errorMessage: 'Unexpected provider request in adapter test.',
        }
      );
      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        stream.push({ type: 'error', reason: message.stopReason, error: message });
      } else if (message.stopReason !== 'pending') {
        stream.push({ type: 'done', reason: message.stopReason, message });
      } else {
        throw new Error('Test replies must be finalized');
      }
      streamStarted.resolve();
    }
    return stream;
  });

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: 'Stable adapter test system prompt.',
    extensionFactories: [
      silentTurnRecoveryExtension((kind) => recoveryKinds.push(kind)),
      ...(options.extensions ?? []),
    ],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime: runtime,
    model,
    thinkingLevel: 'off',
    resourceLoader,
    sessionManager: manager,
    settingsManager: SettingsManager.inMemory({
      retry: { enabled: false },
      compaction: { enabled: false },
    }),
    noTools: 'builtin',
    customTools: [testTool],
  });

  return {
    session,
    manager,
    requests,
    recoveryKinds,
    streamStarted: streamStarted.promise,
    cleanup: () => {
      session.dispose();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const activeHarnesses: Harness[] = [];
afterEach(() => {
  for (const harness of activeHarnesses.splice(0)) harness.cleanup();
});

async function harness(
  plans: Array<ReplyPlan | 'wait-for-abort'>,
  options?: { seedError?: boolean; extensions?: InlineExtension[] }
): Promise<Harness> {
  const current = await createHarness(plans, options);
  activeHarnesses.push(current);
  return current;
}

describe('Pi session adapter integration', () => {
  it('agent_settled 回调尚未结束时拒绝嵌套续跑，不新增请求或结算', async () => {
    let attempted = false;
    let rejection: unknown;
    const current = await harness(
      [
        { content: [], stopReason: 'error', errorMessage: 'HTTP 400 first attempt' },
        { content: [{ type: 'text', text: 'must not be requested' }] },
      ],
      {
        extensions: [
          {
            name: 'settlement-continuation-guard',
            factory: (pi) => {
              pi.on('agent_settled', async () => {
                if (attempted) return;
                attempted = true;
                expect(editLatestAssistantForRetry(current.session)).toBe(true);
                try {
                  await continueSessionActivity(current.session);
                } catch (error) {
                  rejection = error;
                }
              });
            },
          },
        ],
      }
    );
    const settled = vi.fn();
    current.session.subscribe((event) => {
      if (event.type === 'agent_settled') settled();
    });
    await current.session.prompt('original task');

    expect(current.requests).toHaveLength(1);
    expect(rejection).toBeInstanceOf(Error);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(current.session.isIdle).toBe(true);
  });

  it.each([false, true])(
    '无消息续跑的工具前后保留扩展段落（forcePersona=%s），不持久化撤回补丁',
    async (forcePersona) => {
      const current = await harness(
        [
          { content: [], stopReason: 'error', errorMessage: 'HTTP 400 retry fixture' },
          {
            content: [
              { type: 'toolCall', id: 'continued-tool', name: 'adapter_test_tool', arguments: {} },
            ],
            stopReason: 'toolUse',
          },
          { content: [{ type: 'text', text: 'continued with contract' }] },
        ],
        {
          extensions: [
            {
              name: 'continuation-prompt-contract',
              factory: (pi) => {
                pi.on('before_agent_start', (event) => {
                  event.systemPromptOptions.sections.fixture_contract = 'PRESERVED_TOOL_CONTRACT';
                  if (forcePersona)
                    return {
                      systemPrompt: `${event.systemPrompt}\nFORCED_PERSONA_CONTRACT\nPRESERVED_TOOL_CONTRACT`,
                    };
                });
              },
            },
          ],
        }
      );
      await current.session.prompt('original task');
      const systemEntries = () =>
        current.manager
          .getBranch()
          .filter((entry) => entry.type === 'message' && entry.message.role === 'system');
      const beforeRetry = systemEntries().length;
      expect(editLatestAssistantForRetry(current.session)).toBe(true);

      await continueSessionActivity(current.session);

      expect(current.requests).toHaveLength(3);
      for (const request of current.requests.slice(1)) {
        expect(JSON.stringify(request.messages)).toContain('PRESERVED_TOOL_CONTRACT');
        if (forcePersona) expect(contextText(request)).toContain('FORCED_PERSONA_CONTRACT');
      }
      expect(systemEntries()).toHaveLength(beforeRetry);
      expect(
        current.manager
          .getBranch()
          .filter((entry) => entry.type === 'message' && entry.message.role === 'user')
      ).toHaveLength(1);
    }
  );

  it('guarded steer defers without starting an idle activity or persisting user input', async () => {
    const current = await harness([]);
    await expect(
      steerActiveSession(current.session, 'late supplement', undefined, () => {})
    ).resolves.toBe('deferred');
    expect(current.requests).toEqual([]);
    expect(current.session.getSteeringMessages()).toEqual([]);
    expect(current.manager.getBranch().filter((entry) => entry.type === 'message')).toEqual([]);
  });

  it('guarded steer rechecks activity after an async input hook without leaving queued input', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const current = await harness(['wait-for-abort'], {
      extensions: [
        {
          name: 'delayed-input',
          factory: (pi) => {
            pi.on('input', async (event) => {
              if (event.text === 'late supplement') {
                entered.resolve();
                await release.promise;
              }
              return { action: 'continue' };
            });
          },
        },
      ],
    });
    const original = current.session.prompt('original');
    await current.streamStarted;
    const supplement = steerActiveSession(current.session, 'late supplement', undefined, () => {});
    const rejected = expect(supplement).resolves.toBe('deferred');
    await entered.promise;
    await current.session.abort();
    await original;
    release.resolve();
    await rejected;
    expect(current.requests).toHaveLength(1);
    expect(current.session.getSteeringMessages()).toEqual([]);
    expect(
      current.manager
        .getBranch()
        .filter((entry) => entry.type === 'message' && entry.message.role === 'user')
        .map((entry) => entry.type === 'message' && textOf(entry.message))
    ).toEqual(['original']);
  });

  it('guarded queued input can be detached at settle without removing ordinary or custom steering', async () => {
    const current = await harness(['wait-for-abort']);
    const original = current.session.prompt('original');
    await current.streamStarted;
    await current.session.steer('ordinary');
    current.session.agent.steer({
      role: 'custom',
      customType: 'test',
      content: 'extension',
      display: false,
      timestamp: Date.now(),
    });
    let detach: (() => boolean) | undefined;
    expect(
      await steerActiveSession(current.session, 'guarded', undefined, (remove) => {
        detach = remove;
      })
    ).toBe('queued');
    const unsubscribe = current.session.subscribe((event) => {
      if (event.type === 'agent_settled') expect(detach?.()).toBe(true);
    });
    await current.session.abort();
    await original;
    expect(current.session.getSteeringMessages()).toEqual(['ordinary']);
    expect(detach?.()).toBe(false);
    unsubscribe();
    await current.session.prompt('next');
    expect(current.requests.some((context) => contextText(context).includes('guarded'))).toBe(
      false
    );
    expect(current.requests.some((context) => contextText(context).includes('ordinary'))).toBe(
      true
    );
    expect(current.requests.some((context) => contextText(context).includes('extension'))).toBe(
      true
    );
  });

  it('guarded input in the active settlement boundary is consumed once and is no longer detachable', async () => {
    let injected = false;
    let detach: (() => boolean) | undefined;
    const current = await harness(
      [
        { content: [{ type: 'text', text: 'first reply' }] },
        { content: [{ type: 'text', text: 'combined reply' }] },
      ],
      {
        extensions: [
          {
            name: 'boundary-input',
            factory: (pi) => {
              pi.on('agent_before_settle', async () => {
                if (injected) return;
                injected = true;
                expect(
                  await steerActiveSession(current.session, 'supplement', undefined, (remove) => {
                    detach = remove;
                  })
                ).toBe('queued');
              });
            },
          },
        ],
      }
    );
    await current.session.prompt('original');
    expect(current.requests).toHaveLength(2);
    expect(current.session.getSteeringMessages()).toEqual([]);
    expect(detach?.()).toBe(false);
    expect(
      current.manager
        .getBranch()
        .filter((entry) => entry.type === 'message' && entry.message.role === 'user')
        .map((entry) => entry.type === 'message' && textOf(entry.message))
    ).toEqual(['original', 'supplement']);
  });

  it('空回复走 canonical context edit + 临时 context nudge，且不改原用户历史、system 或 tools', async () => {
    const current = await harness([
      { content: [] },
      { content: [{ type: 'text', text: 'Recovered answer.' }] },
    ]);
    const originalSystem = current.session.systemPrompt;

    const settled = vi.fn();
    current.session.subscribe((event) => {
      if (event.type === 'agent_settled') settled();
    });
    await current.session.prompt('Please do the work.');
    expect(settled).toHaveBeenCalledTimes(1);
    expect(current.session.isStreaming).toBe(false);

    expect(current.requests).toHaveLength(2);
    expect(current.recoveryKinds).toEqual(['empty']);
    expect(contextText(current.requests[0]!)).not.toContain(SILENT_TURN_NUDGE);
    expect(contextText(current.requests[1]!)).toContain(SILENT_TURN_NUDGE);
    const firstToolDeclarations = current.requests[0]!.messages.flatMap((message) =>
      message.role === 'system' ? (message.toolsAdded ?? []) : []
    );
    const recoveryToolDeclarations = current.requests[1]!.messages.flatMap((message) =>
      message.role === 'system' ? (message.toolsAdded ?? []) : []
    );
    expect(recoveryToolDeclarations).toEqual(firstToolDeclarations);
    expect(current.session.systemPrompt).toBe(originalSystem);
    expect(current.session.getActiveToolNames()).toContain('adapter_test_tool');

    const branch = current.manager.getBranch();
    const userEntry = branch.find(
      (entry) => entry.type === 'message' && entry.message.role === 'user'
    );
    expect(userEntry?.type === 'message' ? textOf(userEntry.message) : '').toBe(
      'Please do the work.'
    );
    expect(branch.some((entry) => entry.type === 'custom_message')).toBe(false);
    expect(
      contextText({ messages: current.manager.buildSessionContext().messages } as TranscriptContext)
    ).not.toContain(SILENT_TURN_NUDGE);
    expect(
      branch.some((entry) => entry.type === 'context_edit' && entry.replacement === null)
    ).toBe(true);
  });

  it('同一用户轮最多恢复一次，下一轮可重新恢复', async () => {
    const current = await harness([
      { content: [] },
      { content: [] },
      { content: [] },
      { content: [{ type: 'text', text: 'Second recovered answer.' }] },
    ]);

    await current.session.prompt('First request.');
    expect(current.requests).toHaveLength(2);
    expect(current.recoveryKinds).toEqual(['empty']);

    await current.session.prompt('Second request.');

    expect(current.requests).toHaveLength(4);
    expect(current.recoveryKinds).toEqual(['empty', 'empty']);
    expect(contextText(current.requests[1]!)).toContain(SILENT_TURN_NUDGE);
    expect(contextText(current.requests[3]!)).toContain(SILENT_TURN_NUDGE);
  });

  it('工具后的第二次空回复不再自动续跑，post-tool nudge 只出现在恢复请求', async () => {
    const current = await harness([
      {
        content: [{ type: 'toolCall', id: 'call-1', name: 'adapter_test_tool', arguments: {} }],
        stopReason: 'toolUse',
      },
      { content: [] },
      { content: [] },
    ]);

    await current.session.prompt('Use the tool and report the result.');

    expect(current.requests).toHaveLength(3);
    expect(current.recoveryKinds).toEqual(['post-tool']);
    expect(contextText(current.requests[2]!)).toContain(POST_TOOL_EMPTY_NUDGE);
    expect(contextText(current.requests[2]!)).not.toContain(SILENT_TURN_NUDGE);
    expect(
      contextText({ messages: current.manager.buildSessionContext().messages } as TranscriptContext)
    ).not.toContain(POST_TOOL_EMPTY_NUDGE);
  });

  it('agent abort 不触发自动恢复', async () => {
    const current = await harness(['wait-for-abort']);
    const run = current.session.prompt('Cancel this request.');
    await current.streamStarted;
    await current.session.abort();
    await run;

    expect(current.requests).toHaveLength(1);
    expect(current.recoveryKinds).toEqual([]);
  });

  it.each(['empty', 'system', 'assistant'] as const)(
    '无消息继续拒绝%s上下文，不请求provider或触发结算',
    async (shape) => {
      const current = await harness([{ content: [{ type: 'text', text: 'not requested' }] }]);
      current.session.agent.state.messages =
        shape === 'empty'
          ? []
          : shape === 'system'
            ? [{ role: 'system', content: 'only system', timestamp: Date.now() }]
            : [assistant(model, { content: [{ type: 'text', text: 'already finished' }] })];
      let settled = 0;
      current.session.subscribe((event) => {
        if (event.type === 'agent_settled') settled++;
      });
      await expect(continueSessionActivity(current.session)).rejects.toThrow();
      expect(current.requests).toHaveLength(0);
      expect(settled).toBe(0);
      expect(current.session.isIdle).toBe(true);
    }
  );

  it('manual retry 用 canonical context edit 隐藏旧错误而保留原始 session entry', async () => {
    const current = await harness([{ content: [{ type: 'text', text: 'Retry succeeded.' }] }], {
      seedError: true,
    });

    expect(editLatestAssistantForRetry(current.session)).toBe(true);
    expect(current.session.agent.state.messages.at(-1)?.role).toBe('user');
    await continueSessionActivity(current.session);

    expect(current.requests).toHaveLength(1);
    expect(contextText(current.requests[0]!)).toContain('Please retry this request.');
    expect(contextText(current.requests[0]!)).not.toContain('old provider error response');
    expect(
      current.manager
        .getBranch()
        .some(
          (entry) =>
            entry.type === 'message' &&
            entry.message.role === 'assistant' &&
            textOf(entry.message).includes('old provider error response')
        )
    ).toBe(true);
    const displayedText = buildSessionDisplayMessages(current.session)
      .map((message) => textOf(message as { content?: unknown }))
      .join('\n');
    expect(displayedText).toContain('old provider error response');
    expect(displayedText).toContain('Retry succeeded.');
  });

  it('无消息续跑保留完整结算生命周期，只准备 custom 规则而不新增任务或消费 nextTurn', async () => {
    const lifecycle: string[] = [];
    const current = await harness(
      [
        { content: [{ type: 'text', text: 'continued' }] },
        { content: [{ type: 'text', text: 'next answer' }] },
      ],
      {
        seedError: true,
        extensions: [
          {
            name: 'continuation-lifecycle',
            factory: (pi) => {
              pi.on('before_agent_start', (event) => {
                lifecycle.push(`before_agent_start:${event.messageType}`);
              });
              pi.on('agent_before_settle', () => {
                lifecycle.push('agent_before_settle');
              });
              pi.on('agent_settled', () => {
                lifecycle.push('agent_settled');
              });
            },
          },
        ],
      }
    );
    const originalSystem = current.session.systemPrompt;
    const originalTools = current.session.getActiveToolNames();
    await current.session.sendCustomMessage(
      { customType: 'next-turn-only', content: 'pending next-turn context', display: false },
      { deliverAs: 'nextTurn' }
    );
    expect(editLatestAssistantForRetry(current.session)).toBe(true);

    await continueSessionActivity(current.session);

    expect(lifecycle).toEqual([
      'before_agent_start:custom',
      'agent_before_settle',
      'agent_settled',
    ]);
    expect(current.session.isIdle).toBe(true);
    expect(current.requests).toHaveLength(1);
    expect(contextText(current.requests[0]!)).not.toContain('pending next-turn context');
    expect(current.session.systemPrompt).toBe(originalSystem);
    expect(current.session.getActiveToolNames()).toEqual(originalTools);
    const branch = current.manager.getBranch();
    expect(
      branch.filter((entry) => entry.type === 'message' && entry.message.role === 'user')
    ).toHaveLength(1);
    expect(branch.some((entry) => entry.type === 'custom_message')).toBe(false);

    // 独立代理不可泄漏到正常 prompt：下一轮仍执行 hook、注入 nextTurn 并记录真实用户消息。
    await current.session.prompt('next real task');
    expect(lifecycle).toEqual([
      'before_agent_start:custom',
      'agent_before_settle',
      'agent_settled',
      'before_agent_start:user',
      'agent_before_settle',
      'agent_settled',
    ]);
    expect(contextText(current.requests[1]!)).toContain('pending next-turn context');
    expect(contextText(current.requests[1]!)).toContain('next real task');
  });

  it('无消息续跑可被中止，且只结算一次、不留下 busy 状态', async () => {
    const current = await harness(['wait-for-abort'], { seedError: true });
    const settled = vi.fn();
    current.session.subscribe((event) => {
      if (event.type === 'agent_settled') settled();
    });
    expect(editLatestAssistantForRetry(current.session)).toBe(true);
    const run = continueSessionActivity(current.session);
    // 若适配入口失效，先传播启动失败，避免把错误误报成等待 provider 超时。
    await Promise.race([current.streamStarted, run]);
    await current.session.abort();
    await run;

    expect(current.requests).toHaveLength(1);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(current.session.isIdle).toBe(true);
    expect(
      current.manager
        .getBranch()
        .filter((entry) => entry.type === 'message' && entry.message.role === 'user')
    ).toHaveLength(1);
  });

  it('无消息续跑的临时错误仍由 SDK 自动重试，只结算一次且不重放原任务', async () => {
    const current = await harness(
      [
        { content: [], stopReason: 'error', errorMessage: '503 service temporarily unavailable' },
        { content: [{ type: 'text', text: 'retry recovered' }] },
      ],
      { seedError: true }
    );
    current.session.settingsManager.applyOverrides({
      retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 },
    });
    const events: string[] = [];
    current.session.subscribe((event) => {
      if (['auto_retry_start', 'auto_retry_end', 'agent_settled'].includes(event.type))
        events.push(event.type);
    });
    expect(editLatestAssistantForRetry(current.session)).toBe(true);

    await continueSessionActivity(current.session);

    expect(current.requests).toHaveLength(2);
    expect(events).toEqual(['auto_retry_start', 'auto_retry_end', 'agent_settled']);
    expect(current.session.isIdle).toBe(true);
    expect(
      current.manager
        .getBranch()
        .filter((entry) => entry.type === 'message' && entry.message.role === 'user')
    ).toHaveLength(1);
  });

  it('异步 custom 规则准备期间新加入的 nextTurn 不会被续跑吞掉', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const current = await harness(
      [
        { content: [{ type: 'text', text: 'continued' }] },
        { content: [{ type: 'text', text: 'next answer' }] },
      ],
      {
        seedError: true,
        extensions: [
          {
            name: 'delayed-custom-preparation',
            factory: (pi) => {
              pi.on('before_agent_start', async (event) => {
                if (event.messageType !== 'custom') return;
                entered.resolve();
                await release.promise;
              });
            },
          },
        ],
      }
    );
    expect(editLatestAssistantForRetry(current.session)).toBe(true);
    const run = continueSessionActivity(current.session);
    await Promise.race([entered.promise, run]);
    await current.session.sendCustomMessage(
      { customType: 'late-next-turn', content: 'queued during preparation', display: false },
      { deliverAs: 'nextTurn' }
    );
    release.resolve();
    await run;

    expect(contextText(current.requests[0]!)).not.toContain('queued during preparation');
    await current.session.prompt('next real task');
    expect(contextText(current.requests[1]!)).toContain('queued during preparation');
  });
});
