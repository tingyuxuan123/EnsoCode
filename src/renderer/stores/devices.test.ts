import type { DeviceInfo, DeviceOperator } from '@shared/device-host';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setDeviceBridge } from '@/features/devices/bridge';
import {
  deviceInUse,
  devicesOf,
  loadDevices,
  openDevice,
  selectDevice,
  setDeviceStream,
  useDevicesStore,
} from './devices';

const t = (key: string) => key;
vi.mock('@/i18n', () => ({ useI18n: () => ({ t, locale: 'en' }) }));
vi.mock('@/components/ui/toast', () => ({ addToast: vi.fn() }));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: { getState: () => ({ conversations: {} }) },
}));

function device(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    id: 'ios-sim:1',
    platform: 'ios',
    kind: 'simulator',
    name: 'iPhone 17',
    osVersion: '26.0',
    model: null,
    state: 'booted',
    connection: null,
    sessionId: null,
    operator: null,
    problems: [],
    input: true,
    bootedByHost: false,
    ...overrides,
  };
}

function bridgeOf(devices: DeviceInfo[], overrides: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string) => {
    if (method === 'devices.environment')
      return { platform: 'darwin', ios: true, iosStream: true, android: false, problems: [] };
    if (method === 'devices.list') return devices;
    if (method === 'devices.open') return devices[0];
    throw new Error(`unexpected ${method}`);
  });
  const api = {
    request,
    onEvent: vi.fn(() => () => undefined),
    onConnection: vi.fn(() => () => undefined),
    ...overrides,
  };
  setDeviceBridge(api as never);
  return api;
}

beforeEach(() => {
  setDeviceBridge(null);
  useDevicesStore.setState({
    environment: null,
    devices: [],
    loaded: false,
    error: null,
    selected: {},
    opening: {},
    streams: {},
    recording: null,
  });
});

describe('devicesOf', () => {
  it('只返回该会话持有的设备，没有会话时为空', () => {
    const mine = device({ id: 'a', sessionId: 's1' });
    const other = device({ id: 'b', sessionId: 's2' });
    const free = device({ id: 'c', sessionId: null });
    expect(devicesOf([mine, other, free], 's1')).toEqual([mine]);
    expect(devicesOf([mine, other, free], null)).toEqual([]);
  });
});

describe('loadDevices', () => {
  it('读到环境与设备后标记 loaded 并清掉旧错误', async () => {
    bridgeOf([device()]);
    useDevicesStore.setState({ error: 'stale' });
    await loadDevices();
    const state = useDevicesStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.error).toBeNull();
    expect(state.devices).toHaveLength(1);
    expect(state.environment?.platform).toBe('darwin');
  });

  it('没有设备桥时直接给出「未就绪」，不发请求', async () => {
    setDeviceBridge(null);
    await loadDevices();
    const state = useDevicesStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.error).toBe('The device host is not ready');
  });

  it('请求失败时保留错误，不把 loaded 留在 false', async () => {
    setDeviceBridge({
      request: vi.fn(async () => {
        throw new Error('host offline');
      }),
      onEvent: vi.fn(() => () => undefined),
      onConnection: vi.fn(() => () => undefined),
    } as never);
    await loadDevices();
    const state = useDevicesStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.error).toBe('host offline');
  });
});

describe('openDevice', () => {
  it('打开成功后选中它，并清掉 opening 记录', async () => {
    bridgeOf([device({ id: 'a' })]);
    await openDevice('s1', 'a');
    const state = useDevicesStore.getState();
    expect(state.selected.s1).toBe('a');
    expect(state.opening.s1).toBeUndefined();
  });

  it('失败时也清掉 opening，避免面板永远停在「启动中」', async () => {
    setDeviceBridge({
      request: vi.fn(async () => {
        throw new Error('busy');
      }),
      onEvent: vi.fn(() => () => undefined),
      onConnection: vi.fn(() => () => undefined),
    } as never);
    await openDevice('s1', 'a');
    expect(useDevicesStore.getState().opening.s1).toBeUndefined();
    expect(useDevicesStore.getState().selected.s1).toBeUndefined();
  });
});

describe('setDeviceStream / selectDevice', () => {
  it('流的记录按设备 id 存，传 null 删掉', () => {
    setDeviceStream('a', { state: 'live', error: null, drawn: true });
    expect(useDevicesStore.getState().streams.a).toEqual({
      state: 'live',
      error: null,
      drawn: true,
    });
    setDeviceStream('a', null);
    expect(useDevicesStore.getState().streams.a).toBeUndefined();
  });

  it('选中的设备按会话记，互不覆盖', () => {
    selectDevice('s1', 'a');
    selectDevice('s2', 'b');
    expect(useDevicesStore.getState().selected).toEqual({ s1: 'a', s2: 'b' });
  });
});

describe('deviceInUse', () => {
  const operator = (control: DeviceOperator['control']): DeviceOperator => ({
    sessionId: 's1',
    agentName: 'Enso',
    user: control.kind === 'you',
    control,
  });

  it('用户拿着的优先于 agent 正在操作的', () => {
    const held = device({
      id: 'a',
      sessionId: 's1',
      operator: operator({ kind: 'you', since: 1 }),
    });
    const acting = device({
      id: 'b',
      sessionId: 's1',
      operator: operator({ kind: 'agent', acting: true }),
    });
    expect(deviceInUse([acting, held], 's1')?.id).toBe('a');
  });

  it('没有 operator 或不属于该会话的设备不算', () => {
    expect(deviceInUse([device({ sessionId: 's1' })], 's1')).toBeNull();
    expect(
      deviceInUse(
        [device({ sessionId: 's2', operator: operator({ kind: 'agent', acting: true }) })],
        's1'
      )
    ).toBeNull();
  });
});
