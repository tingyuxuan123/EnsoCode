import { describe, expect, it, vi } from 'vitest';
import { deviceBridge, deviceBridgeApi, readDeviceBridge, setDeviceBridge } from './bridge';

const stub = () => ({
  request: vi.fn(),
  onEvent: vi.fn(() => () => undefined),
  onConnection: vi.fn(() => () => undefined),
});

describe('deviceBridgeApi', () => {
  it('接受带 request/onEvent/onConnection 的对象', () => {
    const api = stub();
    expect(deviceBridgeApi(api)).toBe(api);
  });

  it('缺任何一个必需方法就返回 null，而不是抛错', () => {
    expect(deviceBridgeApi(undefined)).toBeNull();
    expect(deviceBridgeApi(null)).toBeNull();
    expect(deviceBridgeApi('nope')).toBeNull();
    expect(deviceBridgeApi({})).toBeNull();
    expect(deviceBridgeApi({ ...stub(), request: undefined })).toBeNull();
    expect(deviceBridgeApi({ ...stub(), onEvent: 'nope' })).toBeNull();
    expect(deviceBridgeApi({ ...stub(), onConnection: 1 })).toBeNull();
  });

  it('可选方法在时必须是函数', () => {
    expect(deviceBridgeApi({ ...stub(), onOpened: 'nope' })).toBeNull();
    expect(deviceBridgeApi({ ...stub(), saveCapture: 'nope' })).toBeNull();
    const api = { ...stub(), onOpened: vi.fn(), saveCapture: vi.fn() };
    expect(deviceBridgeApi(api)).toBe(api);
  });
});

describe('deviceBridge', () => {
  it('没有注入时读 preload 的 window.electronAPI.devices', () => {
    const api = stub();
    vi.stubGlobal('electronAPI', { devices: api });
    setDeviceBridge(undefined);
    expect(readDeviceBridge()).toBe(api);
    expect(deviceBridge()).toBe(api);
    vi.unstubAllGlobals();
  });

  it('preload 没有设备桥时返回 null，让面板显示「未就绪」', () => {
    vi.stubGlobal('electronAPI', {});
    setDeviceBridge(undefined);
    expect(readDeviceBridge()).toBeNull();
    expect(deviceBridge()).toBeNull();
    vi.unstubAllGlobals();
  });

  it('注入的桥优先于 preload，null 表示明确没有', () => {
    const api = stub();
    vi.stubGlobal('electronAPI', { devices: stub() });
    setDeviceBridge(api);
    expect(deviceBridge()).toBe(api);
    setDeviceBridge(null);
    expect(deviceBridge()).toBeNull();
    setDeviceBridge(undefined);
    vi.unstubAllGlobals();
  });
});
