import { EventEmitter } from 'node:events';
import type { AgentCommand } from '@shared/types/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../agent/index?modulePath', () => ({ default: '/tmp/agent.js' }));

const settingsMock = vi.hoisted(() => ({
  value: undefined as Record<string, unknown> | undefined,
}));
vi.mock('../ipc/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ipc/settings')>()),
  readSettings: () => settingsMock.value,
}));

vi.mock('./modelDirectory', () => ({
  getModelDirectorySnapshot: () => ({ revision: 0, generatedAt: 0, providers: [] }),
  onModelDirectoryChanged: () => () => {},
}));

const credentialMock = vi.hoisted(() => ({
  keys: new Set<string>(),
  read: undefined as undefined | (() => Promise<ReadonlySet<string>>),
}));
vi.mock('./oauthProviders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./oauthProviders')>()),
  readStoredOauthCredentialKeys: () =>
    credentialMock.read ? credentialMock.read() : Promise.resolve(new Set(credentialMock.keys)),
}));

class FakeWorker extends EventEmitter {
  posted: AgentCommand[] = [];
  postMessage = vi.fn((command: AgentCommand) => {
    this.posted.push(command);
  });
  kill = vi.fn();
}

const workers: FakeWorker[] = [];
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/enso-code-search-test',
    isPackaged: false,
    getAppPath: () => '/tmp',
    on: () => {},
  },
  utilityProcess: {
    fork: () => {
      const child = new FakeWorker();
      workers.push(child);
      return child;
    },
  },
}));

import {
  pushCodeSearchConfig,
  resolveCodeSearchConfig,
  seedCodeSearchConfig,
  startAgentWorker,
  stopAgentWorker,
} from './agentHost';

const setAccountKey = (accountKey: unknown) => {
  settingsMock.value = {
    'enso-settings': { version: 99, state: { codeSearchAccountKey: accountKey } },
  };
};

const codeSearchCommands = (worker: FakeWorker): AgentCommand[] =>
  worker.posted.filter((command) => command.type === 'set-code-search-config');

async function spawnWorker(): Promise<FakeWorker> {
  startAgentWorker();
  const worker = workers.at(-1);
  if (!worker) throw new Error('worker was not forked');
  worker.emit('spawn');
  await Promise.resolve();
  await Promise.resolve();
  return worker;
}

describe('resolveCodeSearchConfig', () => {
  it('只认显式 devin 选号，并在凭证缺失时降级为 null', () => {
    setAccountKey('devin#2');
    expect(resolveCodeSearchConfig(new Set(['devin', 'devin#2']), 4)).toEqual({
      accountKey: 'devin#2',
      revision: 4,
    });
    expect(resolveCodeSearchConfig(new Set(['devin']), 4)).toEqual({
      accountKey: null,
      revision: 4,
    });
  });

  it('未知账号、非法值或未配置都不切到其它账号', () => {
    for (const value of [undefined, null, '', 'anthropic', 'devin#1', 'devin-session-token']) {
      setAccountKey(value);
      expect(resolveCodeSearchConfig(new Set(['anthropic', 'devin']), 1)).toEqual({
        accountKey: null,
        revision: 1,
      });
    }
  });
});

describe('pushCodeSearchConfig', () => {
  beforeEach(() => {
    stopAgentWorker();
    workers.splice(0);
    credentialMock.read = undefined;
    credentialMock.keys = new Set(['devin', 'devin#2', 'anthropic']);
    setAccountKey('devin');
  });

  it('冷启动在会话命令之前排入权威配置，不等待异步凭证重放', async () => {
    startAgentWorker();
    const worker = workers.at(-1)!;
    seedCodeSearchConfig(new Set(['devin']));
    expect(worker.posted).toEqual([]);
    worker.emit('spawn');
    const first = codeSearchCommands(worker)[0];
    expect(first).toMatchObject({ config: { accountKey: 'devin' } });
    await pushCodeSearchConfig();
  });

  it('按权威凭证下发选号，重复推送同一配置不取消在途搜索', async () => {
    const worker = await spawnWorker();
    await pushCodeSearchConfig();
    const sent = codeSearchCommands(worker);
    expect(sent).toHaveLength(1);
    const first = sent[0];
    if (first?.type !== 'set-code-search-config') throw new Error('unexpected command');
    expect(first.config.accountKey).toBe('devin');
    await pushCodeSearchConfig();
    expect(codeSearchCommands(worker)).toHaveLength(1);
  });

  it('账号变更/撤销单调递增 revision，同 key 强制失效也递增', async () => {
    const worker = await spawnWorker();
    await pushCodeSearchConfig();
    setAccountKey('devin#2');
    await pushCodeSearchConfig();
    await pushCodeSearchConfig({ invalidateAccountKey: 'devin#2' });
    setAccountKey(null);
    await pushCodeSearchConfig();
    const revisions = codeSearchCommands(worker).map((command) =>
      command.type === 'set-code-search-config'
        ? [command.config.accountKey, command.config.revision]
        : null
    );
    expect(revisions).toEqual([
      ['devin', 1],
      ['devin#2', 2],
      ['devin#2', 3],
      [null, 4],
    ]);
  });

  it('无关账号的失效通知不改变选号也不取消在途搜索', async () => {
    const worker = await spawnWorker();
    await pushCodeSearchConfig();
    await pushCodeSearchConfig({ invalidateAccountKey: 'anthropic' });
    expect(codeSearchCommands(worker)).toHaveLength(1);
  });

  it('凭证缺失或读盘失败一律降级为 null', async () => {
    credentialMock.keys = new Set<string>();
    const worker = await spawnWorker();
    await pushCodeSearchConfig();
    credentialMock.read = async () => {
      throw new Error('auth.json unreadable');
    };
    await pushCodeSearchConfig();
    const sent = codeSearchCommands(worker);
    expect(
      sent.map((command) => command.type === 'set-code-search-config' && command.config.accountKey)
    ).toEqual([null]);
    expect(sent).toHaveLength(1);
  });

  it('worker 重建 ready 时重推当前配置（同 revision 不被去重吞掉）', async () => {
    const first = await spawnWorker();
    await pushCodeSearchConfig();
    const firstCommand = codeSearchCommands(first)[0];
    stopAgentWorker();
    const second = await spawnWorker();
    await Promise.resolve();
    await Promise.resolve();
    const replayed = codeSearchCommands(second);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toEqual(firstCommand);
  });

  it('迟到的读盘结果不会覆盖更新的配置', async () => {
    const worker = await spawnWorker();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    credentialMock.read = async () => {
      await gate;
      return new Set(['devin']);
    };
    const slow = pushCodeSearchConfig();
    setAccountKey(null);
    credentialMock.read = undefined;
    const fast = pushCodeSearchConfig();
    release?.();
    await Promise.all([slow, fast]);
    const sent = codeSearchCommands(worker);
    const last = sent.at(-1);
    if (last?.type !== 'set-code-search-config') throw new Error('unexpected command');
    expect(last.config.accountKey).toBeNull();
    expect(sent.every((command) => command.type === 'set-code-search-config')).toBe(true);
  });
});
