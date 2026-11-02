import { EventEmitter } from 'node:events';
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

const identity = { sessionId: 'hot-parent', generation: '11111111-1111-4111-8111-111111111111' };
const request = { sessionId: identity.sessionId, cwd: '/tmp', providerId: 'p', modelId: 'm' };
beforeEach(() => {
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
