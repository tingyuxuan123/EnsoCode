import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { type AgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { AgentWorkerEvent } from '@shared/types/agent';
import { afterEach, expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => ({ sessions: [] as AgentSession[] }));
vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const original = await importOriginal<typeof import('@earendil-works/pi-coding-agent')>();
  return {
    ...original,
    createAgentSession: async (...args: Parameters<typeof original.createAgentSession>) => {
      const result = await original.createAgentSession(...args);
      capture.sessions.push(result.session);
      return result;
    },
  };
});
vi.mock('./cursor/loadProvider', () => ({
  CURSOR_PROVIDER_ID: 'cursor',
  loadCursorProvider: async () => {},
}));
vi.mock('./mcp', () => ({
  McpManager: class {
    toolsFor = async () => [
      {
        name: 'mcp__fixture__read',
        label: 'MCP',
        description: 'Read fixture data',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      },
    ];
    closeAll = async () => {};
  },
}));

import { SessionSupervisor } from './supervisor';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  capture.sessions.length = 0;
  vi.restoreAllMocks();
});

it('real SDK preserves the whole running tool round, then changes the next request without losing MCP, code_search or skills', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'enso-builtin-sdk-'));
  const skill = path.join(root, 'skills', 'fixture');
  mkdirSync(skill, { recursive: true });
  const fullDescription = `Complete skill ${'full capability details '.repeat(60)}SKILL-END`;
  writeFileSync(
    path.join(skill, 'SKILL.md'),
    `---\nname: fixture\ndescription: ${fullDescription}\n---\nFixture instructions.`
  );
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  vi.spyOn(ModelRuntime, 'create').mockResolvedValue(runtime);
  vi.spyOn(runtime, 'refresh').mockResolvedValue({ aborted: false, errors: new Map() });
  vi.spyOn(runtime, 'hasConfiguredAuth').mockReturnValue(true);
  const requests: TranscriptContext[] = [];
  vi.spyOn(runtime, 'streamSimple').mockImplementation((model, context) => {
    requests.push(structuredClone(context as TranscriptContext));
    const stream = createAssistantMessageEventStream();
    const call = requests.length === 1;
    const message: AssistantMessage = {
      role: 'assistant',
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: call
        ? [{ type: 'toolCall', id: 'browser-call', name: 'browser_snapshot', arguments: {} }]
        : [{ type: 'text', text: 'done' }],
      stopReason: call ? 'toolUse' : 'stop',
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
    stream.push({ type: 'done', reason: call ? 'toolUse' : 'stop', message });
    return stream;
  });
  const events: AgentWorkerEvent[] = [];
  const supervisor = new SessionSupervisor({
    emit: (event) => events.push(event),
    agentDir: path.join(root, 'agent'),
    sessionDir: path.join(root, 'sessions'),
  });
  cleanups.push(async () => {
    await supervisor.shutdown();
    for (const session of capture.sessions) session.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  const identity = { sessionId: 'sdk-parent', generation: '11111111-1111-4111-8111-111111111111' };
  supervisor.handleCommand({
    type: 'set-code-search-config',
    config: { accountKey: 'devin', revision: 1 },
  });
  supervisor.handleCommand({
    type: 'spawn-parent',
    identity,
    cwd: root,
    model: {
      api: 'openai-completions',
      baseUrl: 'https://fixture.invalid',
      apiKey: 'fake',
      modelId: 'fixture',
      settingsProviderId: 'fixture',
    },
    skillPaths: [path.join(root, 'skills')],
    mcpServers: [{ id: 'fixture', name: 'fixture', transport: 'stdio', command: 'never-started' }],
    disabledTools: ['memory', 'computer'],
  });
  await vi.waitFor(() => expect(events.some((event) => event.type === 'parent-ready')).toBe(true));
  const session = capture.sessions[0]!;
  const task = session.prompt('Inspect with the browser.');
  await vi.waitFor(() =>
    expect(events.some((event) => event.type === 'browser-invoke')).toBe(true)
  );
  expect(session.isIdle).toBe(false);
  supervisor.handleCommand({
    type: 'set-builtin-tools',
    identity,
    disabledTools: ['browser', 'memory', 'computer'],
  });
  expect(session.getActiveToolNames()).toContain('browser_snapshot');
  const invocation = events.find((event) => event.type === 'browser-invoke');
  if (invocation?.type !== 'browser-invoke') throw new Error('Missing browser invocation');
  supervisor.handleCommand({
    type: 'browser-result',
    identity,
    requestId: invocation.requestId,
    ok: true,
    result: { snapshot: 'captured' },
  });
  await task;
  expect(requests).toHaveLength(2);
  for (const request of requests)
    expect(getCurrentTools(request.messages).map((tool) => tool.name)).toContain(
      'browser_snapshot'
    );
  expect(session.isIdle).toBe(true);
  expect(session.getActiveToolNames()).not.toContain('browser_snapshot');
  expect(session.getCallableToolNames()).not.toContain('browser_snapshot');
  await session.prompt('Continue without browser.');
  const tools = getCurrentTools(requests[2]!.messages).map((tool) => tool.name);
  expect(tools).not.toContain('browser_snapshot');
  expect(tools).toEqual(
    expect.arrayContaining(['mcp__fixture__read', 'code_search', 'codemode', 'subagent'])
  );
  expect(getCurrentSystemPrompt(requests[2]!.messages)).toContain(fullDescription);
  expect(events.some((event) => event.type === 'browser-cancel')).toBe(false);
});
