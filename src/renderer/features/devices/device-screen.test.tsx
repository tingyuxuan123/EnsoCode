// @vitest-environment happy-dom

import type { DeviceInfo, DeviceInput } from '@shared/device-host';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DeviceBridge, setDeviceBridge } from './bridge';
import { DeviceScreen } from './device-screen';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const device: DeviceInfo = {
  id: 'android:emulator-5554',
  platform: 'android',
  kind: 'emulator',
  name: 'Pixel 10 Pro',
  osVersion: '17',
  model: null,
  state: 'booted',
  connection: null,
  sessionId: 'session',
  operator: null,
  problems: [],
  input: true,
  bootedByHost: false,
};

let root: Root;
let container: HTMLDivElement;
let canvas: HTMLCanvasElement;
let inputs: DeviceInput[];

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  inputs = [];
  setDeviceBridge({
    request: vi.fn(async (method: string, params: { input?: DeviceInput }) => {
      if (method === 'devices.input' && params.input) inputs.push(params.input);
      if (method === 'devices.screenshot') return new Promise(() => undefined);
      return undefined;
    }),
    onEvent: () => () => undefined,
    onConnection: () => () => undefined,
  } as DeviceBridge);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <DeviceScreen
        device={device}
        sessionId="session"
        control={null}
        agentName=""
        onHeld={() => undefined}
        onTakeOver={() => undefined}
      />
    )
  );
  canvas = container.querySelector('canvas')!;
  canvas.setPointerCapture = vi.fn();
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 200));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setDeviceBridge(undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function pointer(type: string, clientX: number, buttons: number, altKey = false): void {
  act(() => {
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: type === 'pointermove' ? -1 : 0,
        buttons,
        clientX,
        clientY: 100,
        altKey,
      })
    );
  });
}

const touch = (phase: 'begin' | 'move' | 'end', x: number, finger = 0): DeviceInput => ({
  type: 'touch',
  phase,
  x,
  y: 0.5,
  finger,
});

describe('设备屏幕的拖动收尾', () => {
  it('漏掉鼠标抬起后，第一次无按键移动在最后接触点抬手，不继续滑动', () => {
    pointer('pointerdown', 20, 1);
    pointer('pointermove', 50, 1);
    pointer('pointermove', 90, 0);
    pointer('pointermove', 95, 0);

    expect(inputs).toEqual([touch('begin', 0.2), touch('move', 0.5), touch('end', 0.5)]);
  });

  it('失去指针捕获时释放双指，不采用丢失事件的位置', () => {
    pointer('pointerdown', 20, 1, true);
    pointer('pointermove', 50, 1);
    pointer('lostpointercapture', 0, 0);
    pointer('pointerup', 75, 0);

    expect(inputs).toEqual([
      touch('begin', 0.2),
      touch('begin', 0.8, 1),
      touch('move', 0.5),
      touch('move', 0.5, 1),
      touch('end', 0.5),
      touch('end', 0.5, 1),
    ]);
  });

  it('窗口失焦时抬手，回到屏幕之前无需等下一次移动', () => {
    pointer('pointerdown', 20, 1);
    pointer('pointermove', 50, 1);
    act(() => window.dispatchEvent(new Event('blur')));

    expect(inputs).toEqual([touch('begin', 0.2), touch('move', 0.5), touch('end', 0.5)]);
  });

  it('正常抬手采用抬起位置，随后丢失捕获不重复抬手', () => {
    pointer('pointerdown', 20, 1);
    pointer('pointerup', 60, 0);
    pointer('lostpointercapture', 0, 0);

    expect(inputs).toEqual([touch('begin', 0.2), touch('end', 0.6)]);
  });
});
