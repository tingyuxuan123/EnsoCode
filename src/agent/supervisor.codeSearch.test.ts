import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentWorkerEvent } from '@shared/types/agent';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  options: [] as Array<{ customTools?: Array<{ name: string }> }>,
}));
vi.mock('./cursor/loadProvider', () => ({
  CURSOR_PROVIDER_ID: 'cursor',
  loadCursorProvider: vi.fn(),
}));
vi.mock('./mcp', () => ({
  McpManager: class {
    toolsFor = async () => [];
    closeAll = async () => {};
  },
}));
vi.mock('@earendil-works/pi-coding-agent', async (original) => {
  const actual = await original<Record<string, unknown>>();
  const models = new Map<string, Record<string, unknown>>();
  const providers = new Map<string, Record<string, unknown>>();
  const runtime = {
    registerProvider: (provider: string, config: { models?: Array<{ id: string }> }) => {
      for (const model of config.models ?? [])
        models.set(`${provider}/${model.id}`, { ...model, provider });
      providers.set(provider, { id: provider, stream: vi.fn(), streamSimple: vi.fn() });
    },
    getModel: (provider: string, id: string) => models.get(`${provider}/${id}`),
    getModels: () => [...models.values()],
    getProvider: (id: string) => providers.get(id),
    registerNativeProvider: vi.fn(),
    resolveModel: vi.fn(),
    refresh: async () => ({ aborted: false, errors: new Map() }),
    getAuth: async () => undefined,
  };
  return {
    ...actual,
    ModelRuntime: { create: async () => runtime },
    DefaultResourceLoader: class {
      reload = async () => {};
      getSkills = () => ({ skills: [] });
      getPrompts = () => ({ prompts: [] });
    },
    SessionManager: {
      create: () => ({
        getBranch: () => [],
        appendCustomEntry: () => 'entry',
        buildSessionContext: () => ({ messages: [] }),
      }),
    },
    createAgentSession: async (options: Record<string, unknown>) => {
      mocks.options.push(options);
      return {
        session: {
          model: options.model,
          resourceLoader: options.resourceLoader,
          sessionManager: options.sessionManager,
          sessionFile: '/tmp/test.jsonl',
          messages: [],
          agent: { state: { messages: [] } },
          subscribe: () => () => {},
          abort: async () => {},
          dispose: () => {},
          isIdle: true,
        },
      };
    },
  };
});

import { SessionSupervisor } from './supervisor';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  mocks.options.length = 0;
});
const model = {
  api: 'openai-completions' as const,
  baseUrl: 'https://example.test',
  apiKey: 'test',
  modelId: 'test',
  settingsProviderId: 'test',
};

async function create(disabledTools: string[], configured = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'enso-search-supervisor-'));
  dirs.push(dir);
  const events: AgentWorkerEvent[] = [];
  const supervisor = new SessionSupervisor({
    emit: (event) => events.push(event),
    agentDir: dir,
    sessionDir: dir,
  });
  if (configured)
    supervisor.handleCommand({
      type: 'set-code-search-config',
      config: { accountKey: 'devin', revision: 1 },
    });
  supervisor.handleCommand({
    type: 'spawn-parent',
    cwd: dir,
    identity: { sessionId: dir, generation: '11111111-1111-4111-8111-111111111111' },
    model,
    disabledTools,
  });
  for (
    let n = 0;
    n < 40 && !events.some((e) => e.type === 'parent-ready' || e.type === 'parent-rejected');
    n++
  )
    await new Promise<void>((resolve) => setImmediate(resolve));
  expect(events.find((e) => e.type === 'parent-rejected')).toBeUndefined();
  expect(events.some((e) => e.type === 'parent-ready')).toBe(true);
  return { supervisor, tools: mocks.options.at(-1)?.customTools?.map((tool) => tool.name) ?? [] };
}

describe('supervisor 注册代码搜索', () => {
  it('明确开启且账号配置已到达时才提供内置搜索', async () => {
    const { supervisor, tools } = await create([]);
    expect(tools).toContain('code_search');
    expect(tools).toContain('web_search');
    await supervisor.shutdown();
  });
  it('关闭工具或没有已配置账号时不提供搜索', async () => {
    for (const [disabled, configured] of [
      [['code_search'], true],
      [[], false],
    ] as const) {
      const { supervisor, tools } = await create([...disabled], configured);
      expect(tools).not.toContain('code_search');
      await supervisor.shutdown();
    }
  });
});
