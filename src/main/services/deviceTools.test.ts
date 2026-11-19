import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DeviceAccessEntry } from '@shared/device-agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPath: vi.fn(), call: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: mocks.getPath } }));
vi.mock('./deviceHost', () => ({ deviceHost: { call: mocks.call } }));

const deviceId = 'android:emulator-5554';
const sessionId = 'session-1';
let root: string;
let main: typeof import('./deviceTools');
let changed: DeviceAccessEntry[];
let generation: string;
const open = (signal?: AbortSignal) =>
  main.deviceToolGateway.call({
    caller: { sessionId, generation },
    toolName: 'device_open',
    args: { deviceId },
    signal,
  });
const pending = async () => {
  await vi.waitFor(() => expect(main.listDeviceAccess(sessionId).at(-1)?.decision).toBe(null));
  return main.listDeviceAccess(sessionId).at(-1)!;
};

describe('Main device questions', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    root = mkdtempSync(path.join(os.tmpdir(), 'codekiln-device-'));
    mocks.getPath.mockReturnValue(path.join(root, 'before-setPath'));
    mocks.call.mockImplementation(async (call) => ({
      result:
        call.kind === 'list'
          ? { text: 'devices', value: { devices: [{ id: deviceId, name: 'Pixel' }] } }
          : { text: 'opened' },
    }));
    main = await import('./deviceTools');
    expect(mocks.getPath).not.toHaveBeenCalled();
    mocks.getPath.mockReturnValue(root);
    changed = [];
    generation = 'g1';
    main.bindDeviceToolMain({
      authority: (caller) =>
        caller.generation === generation
          ? { sessionId: caller.sessionId, agentName: 'Test', projectPath: null }
          : null,
      toolEnabled: () => true,
      changed: (entry) => changed.push(entry),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  it('replays the same card and accepts only the first matching answer; revocation is synchronized', async () => {
    const opening = open();
    const entry = await pending();
    expect(changed).toEqual([entry]);
    expect(entry).toMatchObject({
      kind: 'device_access',
      sessionId,
      deviceId,
      deviceName: 'Pixel',
    });
    main.answerDeviceAccess('wrong-session', entry.id, 'always');
    main.answerDeviceAccess(sessionId, 'wrong-entry', 'always');
    expect(changed).toHaveLength(1);
    main.answerDeviceAccess(sessionId, entry.id, 'session');
    main.answerDeviceAccess(sessionId, entry.id, 'always');
    expect(await opening).toEqual({ result: { text: 'opened' } });
    expect(main.listAllowedDeviceAccess()).toEqual([]);
    expect(main.listDeviceAccess(sessionId)).toEqual([{ ...entry, decision: 'session' }]);
    main.revokeDeviceAccess(sessionId, deviceId);
    expect(main.listDeviceAccess(sessionId)).toEqual([
      { ...entry, decision: 'session', revoked: true },
    ]);
    expect(changed.at(-1)).toEqual(main.listDeviceAccess(sessionId)[0]);
    main.destroyDeviceAccessSession(sessionId);
    expect(main.listDeviceAccess(sessionId)).toEqual([]);
  });

  it('expires at 120s even without a renderer and ignores overdue answers before the timer runs', async () => {
    vi.useFakeTimers();
    for (const timerFires of [true, false]) {
      const start = Date.now();
      const opening = open();
      await vi.advanceTimersByTimeAsync(0);
      const entry = main.listDeviceAccess(sessionId).at(-1)!;
      expect(entry.expiresAt).toBe(start + 120000);
      if (timerFires) await vi.advanceTimersByTimeAsync(120000);
      else vi.setSystemTime(entry.expiresAt);
      main.answerDeviceAccess(sessionId, entry.id, 'always');
      expect(await opening).toHaveProperty('error');
      expect(changed.at(-1)?.decision).toBe('timeout');
      expect(main.listAllowedDeviceAccess()).toEqual([]);
    }
  });

  it.each(['abort', 'destroy', 'generation'])('does not grant after %s', async (reason) => {
    const c = new AbortController();
    const opening = open(c.signal);
    const entry = await pending();
    if (reason === 'abort') c.abort();
    if (reason === 'destroy') main.destroyDeviceAccessSession(sessionId);
    if (reason === 'generation') generation = 'g2';
    main.answerDeviceAccess(sessionId, entry.id, 'always');
    expect(await opening).toHaveProperty('error');
    expect(changed.at(-1)?.decision).toBe('timeout');
    expect(main.listAllowedDeviceAccess()).toEqual([]);
    expect(mocks.call.mock.calls.map(([call]) => call.kind)).toEqual(['list']);
  });

  it('writes always only to the final userData and forget removes the disk grant', async () => {
    const opening = open();
    const entry = await pending();
    main.answerDeviceAccess(sessionId, entry.id, 'always');
    expect(await opening).toHaveProperty('result');
    const file = path.join(root, 'state/device-access.json');
    expect(JSON.parse(readFileSync(file, 'utf8')).allowed).toEqual([deviceId]);
    expect(existsSync(path.join(root, 'before-setPath'))).toBe(false);
    main.forgetDeviceAccess(deviceId);
    expect(JSON.parse(readFileSync(file, 'utf8')).allowed).toEqual([]);
  });

  it('never imports grants from the default profile', async () => {
    const oldState = path.join(root, 'before-setPath', 'state');
    mkdirSync(oldState, { recursive: true });
    writeFileSync(
      path.join(oldState, 'device-access.json'),
      JSON.stringify({ version: 1, allowed: [deviceId] })
    );
    expect(main.listAllowedDeviceAccess()).toEqual([]);
    const opening = open();
    const entry = await pending();
    main.answerDeviceAccess(sessionId, entry.id, 'deny');
    expect(await opening).toHaveProperty('error');
  });

  it('forget removes the global grant without revoking another session’s temporary grant', async () => {
    const first = open();
    const entry = await pending();
    main.answerDeviceAccess(sessionId, entry.id, 'session');
    expect(await first).toHaveProperty('result');
    const secondId = 'session-2';
    const second = main.deviceToolGateway.call({
      caller: { sessionId: secondId, generation },
      toolName: 'device_open',
      args: { deviceId },
    });
    await vi.waitFor(() => expect(main.listDeviceAccess(secondId)).toHaveLength(1));
    main.answerDeviceAccess(secondId, main.listDeviceAccess(secondId)[0]!.id, 'always');
    expect(await second).toHaveProperty('result');
    main.forgetDeviceAccess(deviceId);
    expect(main.listAllowedDeviceAccess()).toEqual([]);
    expect(await open()).toHaveProperty('result');
    expect(main.listDeviceAccess(sessionId)).toHaveLength(1);
  });

  it('does not advertise a permanent grant after a failed write', async () => {
    writeFileSync(path.join(root, 'state'), 'not a directory');
    const opening = open();
    const entry = await pending();
    expect(() => main.answerDeviceAccess(sessionId, entry.id, 'always')).toThrow();
    expect(await opening).toHaveProperty('error');
    expect(main.listAllowedDeviceAccess()).toEqual([]);
    expect(changed.at(-1)?.decision).toBe('deny');
  });
});
