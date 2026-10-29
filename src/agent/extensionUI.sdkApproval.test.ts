import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { getModel } from '@earendil-works/pi-ai/compat';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import type { ApprovalMode, AskRequestInfo } from '@shared/types/agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AskManager } from './ask';
import { bindExtensionUI } from './extensionUI';

const QUESTION = 'Allow Computer Use to use "TextEdit"?';
const CHOICES = ['Allow once', 'Allow for this session', 'Always allow', 'Decline'];
const model = getModel('openai', 'gpt-4o-mini');
if (!model) throw new Error('Bundled test model is unavailable');

function assistant(
  providerModel: typeof model,
  content: AssistantMessage['content'],
  stopReason: 'stop' | 'toolUse'
): AssistantMessage {
  return {
    role: 'assistant',
    content,
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
    stopReason,
    timestamp: Date.now(),
  };
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

async function harness(mode: ApprovalMode, prepare = true, autoDecline = false) {
  const root = mkdtempSync(path.join(tmpdir(), 'enso-sdk-approval-'));
  const agentDir = path.join(root, 'agent');
  mkdirSync(agentDir);
  const extensionPath = path.join(root, 'lcu-fixture.mjs');
  // Like LCU, this tool does not exist until before_agent_start has run.
  writeFileSync(
    extensionPath,
    `export default function (pi) {
    pi.on('before_agent_start', () => {
      pi.registerTool({
        name: 'js', label: 'LCU js', description: 'Local approval fixture',
        parameters: { type: 'object', properties: {} },
        async execute(_id, _args, signal, _update, ctx) {
          const choice = await ctx.ui.select(${JSON.stringify(QUESTION)},
            ${JSON.stringify(CHOICES)}, { signal });
          return { content: [{ type: 'text', text: String(choice) }], details: { choice } };
        }
      });
    });
  }`
  );
  const runtime = await ModelRuntime.create({
    authPath: path.join(agentDir, 'auth.json'),
    modelsPath: path.join(agentDir, 'models.json'),
    refreshOnCreate: false,
  });
  vi.spyOn(runtime, 'hasConfiguredAuth').mockReturnValue(true);
  let calls = 0;
  vi.spyOn(runtime, 'streamSimple').mockImplementation((requestModel) => {
    const stream = createAssistantMessageEventStream();
    const first = calls++ === 0;
    const message = assistant(
      requestModel as typeof model,
      first
        ? [{ type: 'toolCall', id: 'sdk-js', name: 'js', arguments: {} }]
        : [{ type: 'text', text: 'Finished.' }],
      first ? 'toolUse' : 'stop'
    );
    stream.push({ type: 'done', reason: message.stopReason as 'toolUse' | 'stop', message });
    return stream;
  });
  const settingsManager = SettingsManager.inMemory({
    retry: { enabled: false },
    compaction: { enabled: false },
  });
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir,
    settingsManager,
    additionalExtensionPaths: [extensionPath],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: 'Run the local js fixture once, then finish.',
  });
  await loader.reload();
  expect(loader.getExtensions().errors).toEqual([]);
  const { session } = await createAgentSession({
    cwd: root,
    agentDir,
    modelRuntime: runtime,
    model,
    thinkingLevel: 'off',
    resourceLoader: loader,
    settingsManager,
    sessionManager: SessionManager.inMemory(root),
    noTools: 'builtin',
  });
  const requests: AskRequestInfo[] = [];
  const requested = Promise.withResolvers<AskRequestInfo>();
  const asks = new AskManager(
    (request) => {
      requests.push(request);
      requested.resolve(request);
      // Keep the mutation check finite if the automatic path regresses to a manual card.
      if (autoDecline) queueMicrotask(() => asks.respond(request.requestId, 'Decline'));
    },
    () => {}
  );
  const bridge = bindExtensionUI(session.extensionRunner, asks, () => true, {
    approvalMode: () => mode,
    lcuExtensionPath: extensionPath,
    getToolDefinition: (name) => session.getToolDefinition(name),
  });
  const results: unknown[] = [];
  session.subscribe((event) => {
    // Deliberately no parentToolCallId filter: nested SDK dispatch uses the same hook.
    if (event.type === 'tool_execution_start' && prepare) bridge.prepareTool(event.toolName);
    if (event.type === 'tool_execution_end') {
      results.push({ result: event.result, isError: event.isError });
    }
  });
  cleanups.push(async () => {
    asks.cancelAll();
    await session.abort();
    session.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  expect(session.getToolDefinition('js')).toBeUndefined();
  return { session, asks, requests, requested: requested.promise, results, calls: () => calls };
}

function expectResult(h: Awaited<ReturnType<typeof harness>>, choice: string) {
  expect(h.session.getToolDefinition('js')).toMatchObject({ name: 'js', label: 'LCU js' });
  expect(h.results).toEqual([
    {
      isError: false,
      result: { content: [{ type: 'text', text: choice }], details: { choice } },
    },
  ]);
  expect(h.calls()).toBe(2);
  expect(h.asks.snapshot()).toEqual([]);
}

describe('Pi 1.0.0 dynamic tool approval dispatch (real SDK, isolated config, no network)', () => {
  it('full 在真实 prompt 动态注册后自动单次授权，不创建 ask-request', async () => {
    const h = await harness('full', true, true);
    await h.session.prompt('Use js once.');
    expect(h.requests).toEqual([]);
    expectResult(h, 'Allow once');
  });

  it('supervised 的真实工具保留人工问题，回答 Decline 后继续完成 prompt', async () => {
    const h = await harness('supervised', true);
    const prompt = h.session.prompt('Use js once.');
    const request = await h.requested;
    expect(h.requests).toHaveLength(1);
    expect(request).toMatchObject({ question: QUESTION, options: CHOICES, selectionOnly: true });
    expect(h.results).toEqual([]);
    h.asks.respond(request.requestId, 'Decline');
    await prompt;
    expectResult(h, 'Decline');
  });

  it('负对照：不调用 prepareTool 时 full 的动态 SDK 工具仍发人工问题', async () => {
    const h = await harness('full', false);
    const prompt = h.session.prompt('Use js once.');
    const request = await h.requested;
    expect(h.requests).toHaveLength(1);
    expect(request).toMatchObject({ question: QUESTION, options: CHOICES, selectionOnly: true });
    h.asks.respond(request.requestId, 'Decline');
    await prompt;
    expectResult(h, 'Decline');
  });
});
