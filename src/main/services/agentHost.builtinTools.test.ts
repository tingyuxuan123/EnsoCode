import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentCommand } from '@shared/types/agent';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../agent/index?modulePath', () => ({ default: '/tmp/agent.js' }));
const settings = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock('../ipc/settings', () => ({
  readSettings: () => ({ 'enso-settings': { version: 99, state: settings.state } }),
}));
vi.mock('./modelDirectory', () => ({
  getModelDirectorySnapshot: () => ({ revision: 0, generatedAt: 0, providers: [] }),
  onModelDirectoryChanged: () => () => {},
}));
vi.mock('./oauthProviders', () => ({ readStoredOauthCredentialKeys: async () => new Set() }));
// 桌面控制只在 macOS/Windows 可用；固定为可用，避免 Linux CI 自动追加 computer 限制
vi.mock('./computer/support', () => ({ isComputerPlatformSupported: () => true }));
class Worker extends EventEmitter {
  posted: AgentCommand[] = [];
  postMessage(command: AgentCommand) {
    this.posted.push(command);
  }
  kill = vi.fn();
}
const workers: Worker[] = [];
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/enso-hot-tools-test',
    isPackaged: false,
    getAppPath: () => '/tmp',
    on: () => {},
  },
  utilityProcess: {
    fork: () => {
      const worker = new Worker();
      workers.push(worker);
      return worker;
    },
  },
}));

import {
  expectedAgentTypeToolIds,
  forgetParentToolProfile,
  isBrowserSessionToolEnabled,
  pushBuiltinTools,
  spawnSession,
  startAgentWorker,
  stopAgentWorker,
} from './agentHost';
import { setNativePluginResources } from './nativePluginResources';

const identity = { sessionId: 'hot-parent', generation: '11111111-1111-4111-8111-111111111111' };
const request = { sessionId: identity.sessionId, cwd: '/tmp', providerId: 'p', modelId: 'm' };
beforeEach(() => {
  setNativePluginResources(undefined);
  stopAgentWorker();
  settings.state = {
    disabledBuiltinTools: ['browser', 'memory', 'computer', 'code_search'],
    providers: [
      {
        id: 'p',
        name: 'P',
        api: 'openai-completions',
        baseUrl: 'https://example.test',
        apiKey: 'fake',
        enabled: true,
        models: [{ id: 'm' }],
      },
    ],
  };
});

it('插件资源只给本机普通父会话，插件预设附角色和指令，失效预设拒绝', () => {
  startAgentWorker();
  const worker = workers.at(-1)!;
  worker.emit('spawn');
  const descriptor = {
    name: 'plugin_enso-example__check',
    description: 'check',
    pluginId: 'enso.example',
    fingerprint: 'a'.repeat(64),
    parameters: { type: 'object' },
  };
  setNativePluginResources((preset) => ({
    tools: [descriptor],
    skillPaths: ['/fixture/plugin-skill'],
    mcpServers: [],
    ...(preset
      ? {
          preset: {
            ok: true as const,
            systemPrompt: 'plugin persona',
            instruction: { path: '/fixture/instruction.md', content: 'plugin instruction' },
          },
        }
      : {}),
  }));
  expect(
    spawnSession(identity, { ...request, presetId: 'plugin:enso.example:review' }, new Set()).ok
  ).toBe(true);
  expect(worker.posted.findLast((c) => c.type === 'spawn-parent')).toMatchObject({
    pluginTools: [descriptor],
    skillPaths: ['/fixture/plugin-skill', '/tmp/resources/design/skills'],
    systemPrompt: 'plugin persona',
    instruction: { content: 'plugin instruction' },
  });
  const ssh = { ...identity, sessionId: 'ssh-parent' };
  spawnSession(ssh, { ...request, sessionId: ssh.sessionId }, new Set(), {
    host: 'fixture',
    auth: 'key',
  });
  expect(worker.posted.findLast((c) => c.type === 'spawn-parent')).not.toHaveProperty(
    'pluginTools'
  );
  setNativePluginResources(() => ({
    tools: [],
    skillPaths: [],
    mcpServers: [],
    preset: { ok: false, error: 'preset disabled' },
  }));
  expect(
    spawnSession(
      { ...identity, sessionId: 'missing' },
      { ...request, sessionId: 'missing', presetId: 'plugin:enso.example:review' },
      new Set()
    )
  ).toMatchObject({ ok: false, error: 'preset disabled' });
  stopAgentWorker();
  setNativePluginResources(undefined);
});

it('pushes effective hot changes per parent generation, updates browser admission, and pins child proof', () => {
  startAgentWorker();
  const worker = workers.at(-1)!;
  worker.emit('spawn');
  expect(
    spawnSession(identity, request, new Set(), undefined, 'project', {
      extraDisabledTools: ['plan'],
    }).ok
  ).toBe(true);
  expect(isBrowserSessionToolEnabled(identity)).toBe(false);
  const proof = expectedAgentTypeToolIds('all', { parentSessionId: identity.sessionId });
  settings.state.disabledBuiltinTools = ['isolated_sandbox'];
  spawnSession(identity, request, new Set(), undefined, 'project');
  expect(expectedAgentTypeToolIds('all', { parentSessionId: identity.sessionId })).toEqual(proof);
  pushBuiltinTools();
  const updates = () => worker.posted.filter((command) => command.type === 'set-builtin-tools');
  expect(updates()).toEqual([{ type: 'set-builtin-tools', identity, disabledTools: ['plan'] }]);
  expect(isBrowserSessionToolEnabled(identity)).toBe(true);
  expect(expectedAgentTypeToolIds('all', { parentSessionId: identity.sessionId })).toEqual(proof);
  pushBuiltinTools();
  expect(updates()).toHaveLength(1);
  settings.state.projects = [{ id: 'project', disabledBuiltinTools: ['browser'] }];
  pushBuiltinTools();
  expect(updates().at(-1)).toMatchObject({ disabledTools: ['browser', 'plan'] });
  expect(isBrowserSessionToolEnabled(identity)).toBe(false);
  forgetParentToolProfile(identity.sessionId);
  settings.state.projects = [];
  pushBuiltinTools();
  expect(updates()).toHaveLength(2);
  stopAgentWorker();
});

it('design switch controls bundled skills and hot tool loadout even over project overrides', () => {
  startAgentWorker();
  const worker = workers.at(-1)!;
  worker.emit('spawn');
  spawnSession(identity, request, new Set(), undefined, 'project');
  expect(worker.posted.findLast((c) => c.type === 'spawn-parent')).toMatchObject({
    skillPaths: ['/tmp/resources/design/skills'],
  });
  settings.state.designEnabled = false;
  settings.state.projects = [{ id: 'project', disabledBuiltinTools: [] }];
  pushBuiltinTools();
  expect(worker.posted.at(-1)).toMatchObject({
    type: 'set-builtin-tools',
    disabledTools: expect.arrayContaining(['design']),
  });
  const cold = { ...identity, sessionId: 'design-off' };
  spawnSession(cold, { ...request, sessionId: cold.sessionId }, new Set());
  const command = worker.posted.findLast((c) => c.type === 'spawn-parent');
  expect(command).not.toHaveProperty('skillPaths');
  expect(command).toMatchObject({ disabledTools: expect.arrayContaining(['design']) });
  settings.state.designEnabled = true;
  pushBuiltinTools();
  expect(worker.posted.at(-1)).toMatchObject({ type: 'set-builtin-tools' });
  stopAgentWorker();
});

it('clears scopes on worker exit/reset; replacement generation owns future pushes', () => {
  startAgentWorker();
  const worker = workers.at(-1)!;
  worker.emit('spawn');
  spawnSession(identity, request, new Set());
  const next = { ...identity, generation: '22222222-2222-4222-8222-222222222222' };
  spawnSession(next, request, new Set());
  settings.state.disabledBuiltinTools = [];
  pushBuiltinTools();
  expect(worker.posted.filter((command) => command.type === 'set-builtin-tools')).toEqual([
    { type: 'set-builtin-tools', identity: next, disabledTools: [] },
  ]);
  worker.emit('exit');
  startAgentWorker();
  const replacement = workers.at(-1)!;
  replacement.emit('spawn');
  settings.state.disabledBuiltinTools = ['browser'];
  pushBuiltinTools();
  expect(replacement.posted.filter((command) => command.type === 'set-builtin-tools')).toEqual([]);
  stopAgentWorker();
});

it.each([false, true])('新建和冷恢复均从 Main 本机设置读取 LCU：resume=%s', (resume) => {
  const dir = mkdtempSync(join(tmpdir(), 'enso-lcu-spawn-'));
  const resumeFile = join(dir, 'session.jsonl');
  writeFileSync(resumeFile, '');
  try {
    startAgentWorker();
    const worker = workers.at(-1)!;
    worker.emit('spawn');
    for (const lcuEnabled of [undefined, true, false, null, 'false', 0]) {
      settings.state.lcuEnabled = lcuEnabled;
      expect(
        spawnSession(identity, { ...request, ...(resume ? { resumeFile } : {}) }, new Set()).ok
      ).toBe(true);
      expect(worker.posted.findLast((command) => command.type === 'spawn-parent')).toMatchObject({
        lcuEnabled: lcuEnabled !== false,
        ...(resume ? { resumeFile } : {}),
      });
    }
  } finally {
    stopAgentWorker();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('warm spawn does not lift a fixed browser restriction', () => {
  startAgentWorker();
  const worker = workers.at(-1)!;
  worker.emit('spawn');
  settings.state.disabledBuiltinTools = [];
  spawnSession(identity, request, new Set(), undefined, undefined, {
    extraDisabledTools: ['browser'],
  });
  spawnSession(identity, request, new Set());
  expect(isBrowserSessionToolEnabled(identity)).toBe(false);
  pushBuiltinTools();
  expect(isBrowserSessionToolEnabled(identity)).toBe(false);
  stopAgentWorker();
});
