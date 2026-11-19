import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DeviceAccessAnswer, DeviceAccessDecision } from '@shared/device-agent';
import type { DeviceToolAnswer } from '@shared/device-tools';
import { deviceRequestOf } from '@shared/device-tools';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceAccessStore, parseDeviceAccessFile } from './access';
import { DeviceToolInvoker } from './invoker';
import { type DeviceHostCall, DeviceToolGateway } from './main';
import { createDeviceTools } from './pi';
import { DEVICE_TOOLS, DeviceTools, deviceToolSpec, isDeviceToolName } from './tools';

const SIM = 'ios-sim:0E02CA7B-60D9-40F6-BCE1-C66A3DECAAEF';
const caller = { sessionId: 's1', generation: 'g1' };

function worker(call: (toolName: string, args: unknown) => Promise<DeviceToolAnswer>) {
  return new DeviceTools(call);
}

describe('device tool declarations', () => {
  it('declares the twenty device tools and no others', () => {
    expect(DEVICE_TOOLS.map((tool) => tool.name)).toEqual([
      'device_list',
      'device_open',
      'device_close',
      'device_snapshot',
      'device_tap',
      'device_fill',
      'device_type',
      'device_scroll',
      'device_swipe',
      'device_press_button',
      'device_rotate',
      'device_screenshot',
      'device_install_app',
      'device_launch_app',
      'device_terminate_app',
      'device_open_url',
      'device_logs',
      'device_set_appearance',
      'device_set_location',
      'device_set_permission',
    ]);
    expect(isDeviceToolName('device_tap')).toBe(true);
    expect(isDeviceToolName('mobile_device')).toBe(false);
    expect(deviceToolSpec('device_tap')?.readOnly).toBe(false);
    expect(deviceToolSpec('device_snapshot')?.readOnly).toBe(true);
  });

  it('declares full types and never asks the model for a session or a device name', () => {
    for (const spec of DEVICE_TOOLS) {
      const schema = spec.parameters as {
        type: string;
        additionalProperties: boolean;
        properties: Record<string, { type?: string }>;
      };
      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);
      for (const [key, field] of Object.entries(schema.properties)) {
        expect(field.type, `${spec.name}.${key}`).toBeTypeOf('string');
      }
      expect(schema.properties.sessionId).toBeUndefined();
      expect(schema.properties.agentName).toBeUndefined();
      expect(schema.properties.projectPath).toBeUndefined();
    }
  });

  it('builds one pi tool per device tool, forwarding to the worker side', async () => {
    const invoke = vi.fn(async (): Promise<DeviceToolAnswer> => ({ result: { text: 'done' } }));
    const tools = createDeviceTools(invoke);
    expect(tools.map((tool) => tool.name)).toEqual(DEVICE_TOOLS.map((spec) => spec.name));
    const tap = tools.find((tool) => tool.name === 'device_tap');
    const { signal } = new AbortController();
    const result = await tap?.execute(
      'call-1',
      { deviceId: SIM, ref: 'e3' } as never,
      signal,
      undefined,
      {} as never
    );
    expect(invoke).toHaveBeenCalledWith('device_tap', { deviceId: SIM, ref: 'e3' }, signal);
    expect(result?.content).toEqual([{ type: 'text', text: 'done' }]);
  });
});

describe('device tool IPC result', () => {
  it('wraps the flat success payload once, keeping image, text and structured value', async () => {
    const emit = vi.fn();
    const invoker = new DeviceToolInvoker(emit);
    const call = invoker.invoke('device_screenshot', { deviceId: SIM });
    const payload = { text: 'screen', image: 'aW1hZ2U=', value: { deviceId: SIM } };
    invoker.resolve({ requestId: emit.mock.calls[0][0].requestId, ok: true, result: payload });
    await expect(call).resolves.toEqual({ result: payload });
  });

  it.each([{ result: { text: 'double envelope' } }, { text: 'screen', image: 42 }])(
    'rejects malformed success payloads',
    async (result) => {
      const emit = vi.fn();
      const invoker = new DeviceToolInvoker(emit);
      const call = invoker.invoke('device_snapshot', { deviceId: SIM });
      invoker.resolve({ requestId: emit.mock.calls[0][0].requestId, ok: true, result });
      await expect(call).resolves.toMatchObject({ error: { code: 'failed' } });
    }
  );
});

describe('device tool arguments', () => {
  it('accepts element references and points', () => {
    expect(deviceRequestOf('device_tap', { deviceId: SIM, ref: 'e3' })).toEqual({
      kind: 'action',
      deviceId: SIM,
      action: { type: 'tap', ref: '@e3', long: false },
    });
    expect(deviceRequestOf('device_tap', { deviceId: SIM, x: 20, y: 40 })).toEqual({
      kind: 'action',
      deviceId: SIM,
      action: { type: 'tap', x: 20, y: 40, long: false },
    });
  });

  it('refuses what could reach a command line as a flag or another command', () => {
    for (const [tool, args] of [
      ['device_tap', { deviceId: SIM, ref: '--help' }],
      ['device_launch_app', { deviceId: SIM, app: '--session=other' }],
      ['device_launch_app', { deviceId: SIM, app: '../x' }],
      ['device_open_url', { deviceId: SIM, url: '--relaunch' }],
      ['device_install_app', { deviceId: SIM, path: '/tmp/script.sh' }],
      ['device_type', { deviceId: SIM, text: 'a\u0000b' }],
      ['device_press_button', { deviceId: SIM, button: 'power-off' }],
      ['device_set_location', { deviceId: SIM, latitude: 91, longitude: 0 }],
      ['device_tap', { x: 1, y: 1 }],
    ] as const) {
      expect(() => deviceRequestOf(tool, args), tool).toThrow();
    }
  });

  it('keeps apps, links and installs it can name', () => {
    expect(deviceRequestOf('device_launch_app', { deviceId: SIM, app: 'com.example.app' })).toEqual(
      {
        kind: 'action',
        deviceId: SIM,
        action: { type: 'launch', app: 'com.example.app' },
      }
    );
    expect(deviceRequestOf('device_open_url', { deviceId: SIM, url: 'myapp://a/b' })).toEqual({
      kind: 'action',
      deviceId: SIM,
      action: { type: 'open_url', url: 'myapp://a/b' },
    });
    expect(deviceRequestOf('device_install_app', { deviceId: SIM, path: 'build/App.app' })).toEqual(
      {
        kind: 'action',
        deviceId: SIM,
        action: { type: 'install', path: 'build/App.app' },
      }
    );
  });

  it('turns bad arguments into an answer the model reads, not a thrown error', async () => {
    const call = vi.fn(async (): Promise<DeviceToolAnswer> => ({ result: { text: 'ok' } }));
    const answer = await worker(call).invoke('device_tap', { deviceId: SIM, ref: 'nope' });
    expect(answer).toMatchObject({ error: { code: 'invalid_params' } });
    expect(call).not.toHaveBeenCalled();
  });
});

describe('device access on Main', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'codekiln-device-access-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  type Commit = (decision: DeviceAccessDecision) => void;
  function finish(commit: Commit, answer: DeviceAccessAnswer): DeviceAccessAnswer {
    if (answer !== 'timeout') commit(answer);
    return answer;
  }

  function gateway(
    answer: DeviceAccessAnswer,
    options: {
      root?: boolean;
      enabled?: boolean;
      always?: string[];
      store?: DeviceAccessStore;
    } = {}
  ) {
    const calls: DeviceHostCall[] = [];
    const store =
      options.store ?? new DeviceAccessStore(path.join(dir, 'state', 'device-access.json'));
    for (const id of options.always ?? []) store.add(id);
    const deps = {
      authority: {
        session: (candidate: { sessionId: string; generation: string }) =>
          options.root === false
            ? null
            : {
                sessionId: candidate.sessionId,
                agentName: 'Claude Code',
                projectPath: '/work/app',
              },
      },
      call: async (call: DeviceHostCall) => {
        calls.push(call);
        if (call.kind === 'list') {
          return {
            result: { text: '', value: { devices: [{ id: SIM, name: 'iPhone 17 Pro' }] } },
          };
        }
        return { result: { text: 'done' } };
      },
      store,
      ask: vi.fn(
        async (
          _session: string,
          _id: string,
          _name: string,
          _signal: AbortSignal,
          _generation: string,
          commit: Commit
        ) => finish(commit, answer)
      ),
      toolEnabled: () => options.enabled ?? true,
    };
    return { gateway: new DeviceToolGateway(deps), deps, calls, store };
  }

  const callOf = (toolName: string, args: unknown = { deviceId: SIM }) => ({
    caller,
    toolName,
    args,
  });

  it('asks once per session and device, then lets the session act', async () => {
    const { gateway: subject, deps, calls } = gateway('session');
    await subject.call(callOf('device_snapshot'));
    await subject.call(callOf('device_tap', { deviceId: SIM, ref: 'e1' }));
    expect(deps.ask).toHaveBeenCalledTimes(1);
    expect(deps.ask).toHaveBeenCalledWith(
      's1',
      SIM,
      'iPhone 17 Pro',
      expect.any(AbortSignal),
      'g1',
      expect.any(Function)
    );
    expect(calls.filter((call) => call.kind === 'action')).toHaveLength(2);
    // The agent name and folder come from Main's record, never from the call.
    expect(calls.find((call) => call.kind === 'action')).toMatchObject({
      agentName: 'Claude Code',
      projectPath: '/work/app',
    });
  });

  it('asks again after a session is released, for that session and device only', async () => {
    const { gateway: subject, deps, calls } = gateway('session');
    const other = { sessionId: 's2', generation: 'g2' };
    await subject.call(callOf('device_snapshot'));
    await subject.call({ caller: other, toolName: 'device_snapshot', args: { deviceId: SIM } });
    expect(deps.ask).toHaveBeenCalledTimes(2);

    subject.release('s1');
    await subject.call({ caller: other, toolName: 'device_snapshot', args: { deviceId: SIM } });
    expect(deps.ask).toHaveBeenCalledTimes(2);
    vi.mocked(deps.ask).mockResolvedValueOnce('deny');
    const refused = await subject.call(callOf('device_tap', { deviceId: SIM, ref: 'e1' }));
    expect(deps.ask).toHaveBeenCalledTimes(3);
    expect(refused).toMatchObject({ error: { code: 'not_allowed' } });
    expect(calls.filter((call) => call.kind === 'action')).toHaveLength(3);
  });

  it('ends turn control without forgetting the grant; revoke asks again', async () => {
    const { gateway: subject, deps, calls } = gateway('session');
    await subject.call(callOf('device_snapshot'));
    subject.turnEnded('s1');
    expect(subject.control(SIM)).toEqual({ kind: 'idle' });
    await subject.call(callOf('device_snapshot'));
    expect(deps.ask).toHaveBeenCalledTimes(1);
    subject.revoke('s1', SIM);
    deps.ask.mockResolvedValueOnce('deny');
    expect(await subject.call(callOf('device_snapshot'))).toMatchObject({
      error: { code: 'not_allowed' },
    });
    expect(calls.filter((call) => call.kind === 'action')).toHaveLength(2);
  });

  it.each(['abort', 'stale', 'disabled', 'turnEnded', 'revoke', 'destroy'] as const)(
    '%s during approval: a late always answer neither writes nor opens',
    async (reason) => {
      const options = { root: true, enabled: true };
      const { gateway: subject, deps, calls, store } = gateway('deny', options);
      const asked = Promise.withResolvers<void>();
      const answer = Promise.withResolvers<DeviceAccessAnswer>();
      const controller = new AbortController();
      deps.ask.mockImplementationOnce(() => {
        asked.resolve();
        return answer.promise;
      });
      const opening = subject.call({ ...callOf('device_open'), signal: controller.signal });
      await asked.promise;
      if (reason === 'abort') controller.abort();
      if (reason === 'stale') options.root = false;
      if (reason === 'disabled') options.enabled = false;
      if (reason === 'turnEnded') subject.turnEnded('s1');
      if (reason === 'revoke') subject.revoke('s1', SIM);
      if (reason === 'destroy') subject.release('s1');
      const commit = deps.ask.mock.calls[0][5];
      expect(commit).toBeTypeOf('function');
      expect(() => commit('always')).toThrow();
      answer.resolve('always');
      expect(await opening).toHaveProperty('error');
      expect(store.has(SIM)).toBe(false);
      options.root = true;
      options.enabled = true;
      expect(await subject.call(callOf('device_open'))).toMatchObject({
        error: { code: 'not_allowed' },
      });
      expect(calls.every((call) => call.kind === 'list')).toBe(true);
    }
  );

  it('does not ask after cancellation during discovery, even if the list still returns', async () => {
    const { gateway: subject, deps } = gateway('always');
    const controller = new AbortController();
    const listed = Promise.withResolvers<void>();
    const callHost = deps.call;
    deps.call = async (call) => {
      await listed.promise;
      return callHost(call);
    };
    const opening = subject.call({ ...callOf('device_open'), signal: controller.signal });
    controller.abort();
    listed.resolve();
    expect(await opening).toHaveProperty('error');
    expect(deps.ask).not.toHaveBeenCalled();
  });

  it('shares one discovery/question; only the still-live waiter may act', async () => {
    const { gateway: subject, deps, calls } = gateway('deny');
    const asked = Promise.withResolvers<void>();
    const answer = Promise.withResolvers<DeviceAccessAnswer>();
    deps.ask.mockImplementation(() => {
      asked.resolve();
      return answer.promise;
    });
    const first = new AbortController();
    const cancelled = subject.call({ ...callOf('device_snapshot'), signal: first.signal });
    const live = subject.call(callOf('device_open'));
    await asked.promise;
    first.abort();
    deps.ask.mock.calls[0][5]('session');
    answer.resolve('session');
    expect(await cancelled).toHaveProperty('error');
    expect(await live).toHaveProperty('result');
    expect(deps.ask).toHaveBeenCalledTimes(1);
    expect(calls.map((call) => call.kind)).toEqual(['list', 'open']);
  });

  it.each(['abort', 'stale', 'revoke', 'forget always'] as const)(
    '%s during takeover prevents a late action',
    async (reason) => {
      const options = { root: true };
      const {
        gateway: subject,
        calls,
        store,
      } = gateway(reason === 'forget always' ? 'always' : 'session', options);
      await subject.call(callOf('device_snapshot'));
      subject.takeOver(SIM);
      const controller = new AbortController();
      const acting = subject.call({
        ...callOf('device_tap', { deviceId: SIM, ref: 'e1' }),
        signal: controller.signal,
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (reason === 'abort') controller.abort();
      if (reason === 'stale') options.root = false;
      if (reason === 'revoke') subject.revoke('s1', SIM);
      if (reason === 'forget always') store.remove(SIM);
      subject.handBack(SIM);
      expect(await acting).toHaveProperty('error');
      expect(calls.filter((call) => call.kind === 'action')).toHaveLength(1);
    }
  );

  it('ending another session cannot release the user’s takeover', async () => {
    const { gateway: subject } = gateway('session');
    await subject.call(callOf('device_snapshot'));
    subject.takeOver(SIM);
    const other = subject.call({
      ...callOf('device_snapshot'),
      caller: { sessionId: 's2', generation: 'g2' },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    subject.turnEnded('s2');
    try {
      expect(subject.control(SIM)).toMatchObject({ kind: 'you' });
    } finally {
      subject.handBack(SIM);
      await other;
    }
  });

  it('a late answer from a cancelled card cannot complete a replacement question', async () => {
    const { gateway: subject, deps, calls, store } = gateway('deny');
    const old = Promise.withResolvers<DeviceAccessAnswer>();
    const replacement = Promise.withResolvers<DeviceAccessAnswer>();
    deps.ask.mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise);
    const controller = new AbortController();
    const first = subject.call({ ...callOf('device_open'), signal: controller.signal });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    const next = subject.call(callOf('device_open'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    old.resolve('always');
    expect(await first).toHaveProperty('error');
    const joined = subject.call(callOf('device_snapshot'));
    replacement.resolve('deny');
    expect(await next).toHaveProperty('error');
    expect(await joined).toHaveProperty('error');
    expect(deps.ask).toHaveBeenCalledTimes(2);
    expect(calls.every((call) => call.kind === 'list')).toBe(true);
    expect(store.has(SIM)).toBe(false);
  });

  it.each(['device_list', 'device_close', 'device_open', 'device_snapshot'])(
    'a pre-aborted %s never reaches the host',
    async (toolName) => {
      const { gateway: subject, deps, calls } = gateway('session');
      const result = await subject.call({
        ...callOf(toolName, toolName === 'device_list' ? {} : { deviceId: SIM }),
        signal: AbortSignal.abort(),
      });
      expect(result).toHaveProperty('error');
      expect(deps.ask).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
    }
  );

  it('does nothing on the device when the user denies or does not answer', async () => {
    for (const answer of ['deny', 'timeout'] as const) {
      const { gateway: subject, calls } = gateway(answer);
      const result = await subject.call(callOf('device_open'));
      expect(result).toMatchObject({ error: { code: 'not_allowed' } });
      expect(calls.some((call) => call.kind !== 'list')).toBe(false);
    }
  });

  it('skips the question for a device the user always allows, and keeps it allowed', async () => {
    const first = gateway('always');
    await first.gateway.call(callOf('device_open'));
    expect(first.store.has(SIM)).toBe(true);

    const second = gateway('deny', { always: [SIM] });
    await second.gateway.call(callOf('device_open'));
    expect(second.deps.ask).not.toHaveBeenCalled();
  });

  it('forget between the synchronous decision and the tool continuation wins', async () => {
    const { gateway: subject, deps, calls, store } = gateway('always');
    let visibleAtDecision = false;
    deps.ask.mockImplementationOnce(async (_session, _id, _name, _signal, _generation, commit) => {
      commit('always');
      visibleAtDecision = store.has(SIM);
      store.remove(SIM);
      return 'always';
    });
    expect(await subject.call(callOf('device_open'))).toHaveProperty('error');
    expect(visibleAtDecision).toBe(true);
    expect(calls.every((call) => call.kind === 'list')).toBe(true);
    expect(store.has(SIM)).toBe(false);
  });

  it('an answer without a committed grant cannot authorize a call', async () => {
    const { gateway: subject, deps, calls, store } = gateway('deny');
    deps.ask.mockResolvedValueOnce('always');
    expect(await subject.call(callOf('device_open'))).toHaveProperty('error');
    expect(calls.every((call) => call.kind === 'list')).toBe(true);
    expect(store.has(SIM)).toBe(false);
    expect(() => deps.ask.mock.calls[0][5]('always')).toThrow();
  });

  it('answers listing without asking', async () => {
    const { gateway: subject, deps } = gateway('deny');
    const result = await subject.call({ caller, toolName: 'device_list', args: {} });
    expect('result' in result).toBe(true);
    expect(deps.ask).not.toHaveBeenCalled();
  });

  it('refuses a caller that is not the live local root session', async () => {
    const { gateway: subject, calls } = gateway('session', { root: false });
    expect(await subject.call(callOf('device_snapshot'))).toMatchObject({
      error: { code: 'not_allowed' },
    });
    expect(calls).toHaveLength(0);
  });

  it('refuses when the tool group is switched off, even with a permission', async () => {
    const { gateway: subject, calls } = gateway('session', { enabled: false, always: [SIM] });
    expect(await subject.call(callOf('device_snapshot'))).toMatchObject({
      error: { code: 'not_allowed' },
    });
    expect(calls).toHaveLength(0);
  });

  it('re-checks the action Main forwards, so a worker cannot widen it', async () => {
    const { gateway: subject, calls } = gateway('session');
    const result = await subject.call(
      callOf('device_launch_app', { deviceId: SIM, app: '--session=other' })
    );
    expect(result).toMatchObject({ error: { code: 'invalid_params' } });
    expect(calls.some((call) => call.kind === 'action')).toBe(false);
  });

  it('waits for the user to hand the device back before acting', async () => {
    const { gateway: subject, calls } = gateway('session');
    await subject.call(callOf('device_open'));
    await subject.call(callOf('device_snapshot'));
    const acted = calls.filter((call) => call.kind === 'action').length;
    expect(subject.takeOver(SIM)).toBe(true);
    expect(subject.control(SIM)).toMatchObject({ kind: 'you' });
    const acting = subject.call(callOf('device_tap', { deviceId: SIM, ref: 'e1' }));
    await Promise.resolve();
    expect(calls.filter((call) => call.kind === 'action')).toHaveLength(acted);
    expect(subject.handBack(SIM)).toBe(true);
    await expect(acting).resolves.toMatchObject({ result: { text: 'done' } });
    expect(calls.filter((call) => call.kind === 'action')).toHaveLength(acted + 1);
  });
});

describe('always-allowed devices file', () => {
  it('keeps only device ids, once each', () => {
    expect(
      parseDeviceAccessFile({
        allowed: [SIM, SIM, 'android:emulator-5554', '../etc', 7, 'x:y'],
      })
    ).toEqual({ version: 1, allowed: [SIM, 'android:emulator-5554'] });
    expect(typeof parseDeviceAccessFile({ allowed: 'all' })).toBe('string');
    expect(typeof parseDeviceAccessFile(null)).toBe('string');
  });

  it('failed writes leave the last committed grant set intact and report the error', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'codekiln-device-access-'));
    try {
      const stateDir = path.join(dir, 'state');
      const store = new DeviceAccessStore(path.join(stateDir, 'access.json'));
      store.add(SIM);
      renameSync(stateDir, path.join(dir, 'original'));
      writeFileSync(stateDir, 'not a directory');
      expect(() => store.remove(SIM)).toThrow();
      expect(() => store.add('android:phone')).toThrow();
      expect(store.list()).toEqual([SIM]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a new persisted grant beyond the file capacity', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'codekiln-device-access-'));
    try {
      const file = path.join(dir, 'device-access.json');
      const allowed = Array.from({ length: 500 }, (_, i) => `android:${i}`);
      writeFileSync(file, JSON.stringify({ version: 1, allowed }));
      const store = new DeviceAccessStore(file);
      expect(() => store.add(allowed[0])).not.toThrow();
      expect(() => store.add(SIM)).toThrow();
      expect(store.list()).toEqual(allowed);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads and writes the file, and ignores a broken one', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'codekiln-device-access-'));
    try {
      const file = path.join(dir, 'state', 'device-access.json');
      const store = new DeviceAccessStore(file);
      expect(store.list()).toEqual([]);
      store.add(SIM);
      expect(() => store.add('nope')).toThrow();
      expect(() => store.remove('nope')).toThrow();
      expect(store.list()).toEqual([SIM]);
      expect(new DeviceAccessStore(file).has(SIM)).toBe(true);

      store.remove(SIM);
      expect(new DeviceAccessStore(file).has(SIM)).toBe(false);

      const broken = mkdtempSync(path.join(tmpdir(), 'codekiln-device-access-'));
      try {
        const log = vi.fn();
        mkdirSync(path.join(broken, 'state'), { recursive: true });
        writeFileSync(path.join(broken, 'state', 'device-access.json'), '{');
        expect(
          new DeviceAccessStore(path.join(broken, 'state', 'device-access.json'), log).list()
        ).toEqual([]);
        expect(log).toHaveBeenCalled();
      } finally {
        rmSync(broken, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
