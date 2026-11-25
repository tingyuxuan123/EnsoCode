import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ForkOptions } from 'electron';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  child: undefined as unknown,
  userData: '',
  fork: vi.fn((_entry: string, _args: string[], _options: ForkOptions) => mocks.child),
}));
vi.mock('../../agent/index?modulePath', () => ({ default: '/fixture/agent.js' }));
vi.mock('electron', async (original) => {
  const actual = await original<typeof import('electron')>();
  return {
    ...actual,
    app: {
      ...actual.app,
      getAppPath: () => process.cwd(),
      getPath: () => mocks.userData,
    },
    utilityProcess: { fork: mocks.fork },
  };
});

import {
  setAgentEventListener,
  startAgentWorker,
  stopAgentWorker,
  stopAgentWorkerForQuit,
} from './agentHost';
import { recordAgentWorkerGone } from './agentWorkerDiagnostics';

const makeChild = (pid?: number) =>
  Object.assign(new EventEmitter(), { pid, postMessage: vi.fn(), kill: vi.fn() });

const logPath = () => path.join(mocks.userData, 'logs', 'agent-worker-exits.log');
const lines = async (): Promise<unknown[]> => {
  const log = await readFile(logPath(), 'utf8').catch(() => '');
  return log
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

beforeEach(async () => {
  mocks.userData = await mkdtemp(path.join(tmpdir(), 'enso-worker-diagnostics-'));
  mocks.fork.mockClear();
});

afterEach(async () => {
  setAgentEventListener(() => {});
  stopAgentWorker();
  await rm(mocks.userData, { recursive: true, force: true });
});

it('persists the PID seen at spawn even when Electron clears it before emitting exit', async () => {
  const child = makeChild(12345);
  mocks.child = child;
  const onEvent = vi.fn();
  setAgentEventListener(onEvent);
  startAgentWorker();
  child.emit('spawn');
  child.pid = undefined;
  child.emit('exit', 23);

  expect(onEvent).toHaveBeenCalledWith({ type: 'worker-exited' });
  await vi.waitFor(async () => {
    const records = await lines();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      event: 'exit',
      pid: 12345,
      exitCode: 23,
      stopRequested: false,
    });
  });
});

it('associates late Electron reasons with the exact worker and preserves both exit codes', async () => {
  const old = makeChild(123);
  mocks.child = old;
  startAgentWorker();
  old.emit('spawn');
  const oldName = mocks.fork.mock.calls[0][2].serviceName;
  old.emit('exit', 23);

  const next = makeChild(456);
  mocks.child = next;
  startAgentWorker();
  next.emit('spawn');
  const nextName = mocks.fork.mock.calls[1][2].serviceName;
  expect(nextName).not.toEqual(oldName);
  recordAgentWorkerGone({
    type: 'Utility',
    serviceName: 'node.mojom.NodeService',
    name: 'codekiln-device-host',
    reason: 'oom',
    exitCode: 123,
  });
  recordAgentWorkerGone({
    type: 'Utility',
    serviceName: 'node.mojom.NodeService',
    name: oldName,
    reason: 'abnormal-exit',
    exitCode: 5888,
  });
  recordAgentWorkerGone({
    type: 'Utility',
    serviceName: 'node.mojom.NodeService',
    name: nextName,
    reason: 'killed',
    exitCode: 9,
  });
  next.emit('exit', 9);

  await vi.waitFor(async () => {
    expect(await lines()).toMatchObject([
      { event: 'exit', serviceName: oldName, pid: 123, exitCode: 23 },
      {
        event: 'child-process-gone',
        serviceName: oldName,
        pid: 123,
        reason: 'abnormal-exit',
        electronExitCode: 5888,
      },
      {
        event: 'child-process-gone',
        serviceName: nextName,
        pid: 456,
        reason: 'killed',
        electronExitCode: 9,
      },
      { event: 'exit', serviceName: nextName, pid: 456, exitCode: 9 },
    ]);
  });
});

it('records an intentional shutdown without making up an Electron reason', async () => {
  const child = makeChild(567);
  mocks.child = child;
  startAgentWorker();
  child.emit('spawn');
  const stopped = stopAgentWorkerForQuit(100);
  child.emit('exit', 0);
  await stopped;

  await vi.waitFor(async () => {
    const records = await lines();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ event: 'exit', pid: 567, exitCode: 0, stopRequested: true });
    expect(records[0]).not.toHaveProperty('reason');
  });
});
