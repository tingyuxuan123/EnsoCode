// @vitest-environment happy-dom

import type { DeviceInfo } from '@shared/device-host';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDevicesStore } from '@/stores/devices';
import { setDeviceBridge } from './bridge';
import { DevicesPane } from './devices-pane';

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    // 英文原文 key + 插值，和真实的 translate('en', …) 一致。
    t: (key: string, params?: Record<string, string | number>) =>
      params
        ? key.replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(params[token] ?? ''))
        : key,
    locale: 'en',
  }),
}));
// 会话 store 在模块顶层就会碰 window.electronAPI；面板只需要「有没有待批准的设备请求」。
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: (select: (state: unknown) => unknown) =>
    select({ conversations: {}, activeId: null }),
}));
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: React.ReactElement }) => render,
  TooltipPopup: () => null,
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
    sessionId: 'conv',
    operator: null,
    problems: [],
    input: true,
    bootedByHost: false,
    ...overrides,
  };
}

let root: Root;
let container: HTMLElement;

async function mount(): Promise<void> {
  await act(async () => root.render(<DevicesPane conversationId="conv" />));
  await act(async () => Promise.resolve());
}

beforeEach(() => {
  document.documentElement.lang = 'en';
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.getElementById('root') as HTMLElement;
  root = createRoot(container);
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

afterEach(async () => {
  await act(async () => root.unmount());
  setDeviceBridge(null);
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('DevicesPane', () => {
  it('没有设备桥时说设备主机未就绪，而不是崩或空面板', async () => {
    setDeviceBridge(null);
    await mount();
    expect(container.textContent).toContain('The device host is not ready');
  });

  it('有桥但没有任何设备时，列出可添加的设备而不是空面板', async () => {
    setDeviceBridge({
      request: vi.fn(async (method: string) => {
        if (method === 'devices.environment')
          return { platform: 'darwin', ios: true, iosStream: true, android: true, problems: [] };
        if (method === 'devices.list') return [device({ sessionId: null })];
        return undefined;
      }),
      onEvent: vi.fn(() => () => undefined),
      onConnection: vi.fn(() => () => undefined),
    } as never);
    await mount();
    expect(container.textContent).toContain('Open a device');
    expect(container.textContent).toContain('iPhone 17');
  });

  it('会话持有设备时，头部直接是设备标签和添加按钮', async () => {
    setDeviceBridge({
      request: vi.fn(async (method: string) => {
        if (method === 'devices.environment')
          return { platform: 'darwin', ios: true, iosStream: true, android: false, problems: [] };
        if (method === 'devices.list') return [device()];
        if (method === 'devices.frame') return { frame: null };
        if (method === 'devices.watch') return { screen: null };
        return undefined;
      }),
      onEvent: vi.fn(() => () => undefined),
      onConnection: vi.fn(() => () => undefined),
    } as never);
    await mount();
    const tab = container.querySelector('[role="tab"]');
    expect(tab?.getAttribute('aria-selected')).toBe('true');
    expect(tab?.textContent).toContain('iPhone 17');
    // 画面区域已挂载（canvas 由 DeviceScreen 渲染）。
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('设备缺少前置条件时给出准备步骤，而不是黑屏', async () => {
    setDeviceBridge({
      request: vi.fn(async (method: string) => {
        if (method === 'devices.environment')
          return { platform: 'darwin', ios: true, iosStream: true, android: false, problems: [] };
        if (method === 'devices.list')
          return [device({ state: 'connected', problems: ['usb-required'] })];
        return undefined;
      }),
      onEvent: vi.fn(() => () => undefined),
      onConnection: vi.fn(() => () => undefined),
    } as never);
    await mount();
    expect(container.textContent).toContain('Get iPhone 17 ready');
    expect(container.textContent).toContain('Connect with a cable');
  });
});
