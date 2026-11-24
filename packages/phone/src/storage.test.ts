import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDeviceData,
  loadDevices,
  loadLastSession,
  pinReplayVersion,
  saveDevices,
  saveLastSession,
} from './storage';

vi.mock('./sessionCache', () => ({ phoneCache: { clear: async () => {} } }));

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('last phone view', () => {
  it('能力钉跨加载保留且旧 App 副本保存不能抹掉，同 pairId 换 key 不继承', () => {
    const device = {
      pairId: 'p1',
      token: 't',
      contentKey: 'key',
      deviceName: 'phone',
      relayUrl: 'https://relay',
      pairedAt: 1,
      label: 'host',
    };
    saveDevices([device]);
    pinReplayVersion(device);
    expect(loadDevices()[0].replayVersion).toBe(1);
    saveDevices([device]);
    expect(loadDevices()[0].replayVersion).toBe(1);
    saveDevices([{ ...device, contentKey: 'new-key' }]);
    expect(loadDevices()[0].replayVersion).toBeUndefined();
    expect(() => pinReplayVersion(device)).toThrow();
  });
  it('keeps selections isolated across computers and clears them on unpair', () => {
    saveLastSession('p1', 'code-a');
    saveLastSession('p2', 'code-b');
    expect(loadLastSession('p1')).toBe('code-a');
    clearDeviceData('p1');
    expect(loadLastSession('p1')).toBeNull();
    expect(loadLastSession('p2')).toBe('code-b');
    expect(loadLastSession(null)).toBeNull();
  });
});
