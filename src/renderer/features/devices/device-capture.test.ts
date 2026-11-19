// @vitest-environment happy-dom

import type { DeviceInfo } from '@shared/device-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDeviceBridge } from './bridge';
import { shareCanvas, startRecording, stopRecording } from './device-capture';

vi.mock('@/components/ui/toast', () => ({ addToast: vi.fn() }));

function device(): DeviceInfo {
  return {
    id: 'android:emulator-5554',
    platform: 'android',
    kind: 'emulator',
    name: 'Pixel 10 Pro',
    osVersion: '17',
    model: null,
    state: 'booted',
    connection: null,
    sessionId: 's1',
    operator: null,
    problems: [],
    input: true,
    bootedByHost: false,
  };
}

/** A recorder that keeps the data it is given, so `onstop` can hand it to the save path. */
class FakeRecorder {
  static isTypeSupported = () => true;
  static instance: FakeRecorder | null = null;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'video/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeRecorder.instance = this;
  }
  start(): void {
    this.state = 'recording';
    queueMicrotask(() => this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) }));
  }
  stop(): void {
    this.state = 'inactive';
    void Promise.resolve().then(() => this.onstop?.());
  }
}

let draws: number;
let source: HTMLCanvasElement;

beforeEach(() => {
  draws = 0;
  vi.useFakeTimers();
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  const context = {
    drawImage: () => {
      draws += 1;
    },
  };
  source = {
    width: 1080,
    height: 2400,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  // happy-dom 没有 2D 画布，这里用一个只记录 drawImage 的替身。
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const element = {
      tagName: tag.toUpperCase(),
      width: 0,
      height: 0,
      getContext: () => context,
      captureStream: () => ({ getTracks: () => [{ stop: () => undefined }] }),
    };
    return element as unknown as HTMLElement;
  }) as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setDeviceBridge(null);
  FakeRecorder.instance = null;
});

describe('screen recording', () => {
  it('录制期间按固定节奏把设备画面拷到画布，画面静止也有帧', async () => {
    const saveCapture = vi.fn(async () => '/tmp/Downloads/x.webm');
    setDeviceBridge({
      request: vi.fn(),
      onEvent: vi.fn(() => () => undefined),
      onConnection: vi.fn(() => () => undefined),
      saveCapture,
    } as never);
    shareCanvas('android:emulator-5554', source);
    startRecording(device());
    expect(FakeRecorder.instance?.state).toBe('recording');
    const first = draws;
    expect(first).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(draws).toBeGreaterThan(first);
  });

  it('停止后把录到的字节存到 Downloads，并停掉拷贝节奏', async () => {
    const saveCapture = vi.fn(async () => '/tmp/Downloads/x.webm');
    setDeviceBridge({
      request: vi.fn(),
      onEvent: vi.fn(() => () => undefined),
      onConnection: vi.fn(() => () => undefined),
      saveCapture,
    } as never);
    shareCanvas('android:emulator-5554', source);
    startRecording(device());
    await vi.advanceTimersByTimeAsync(200);
    stopRecording();
    // 保存链路是「停止 → Blob → ArrayBuffer → IPC」，多走几个任务队列再断言。
    for (let i = 0; i < 8 && !saveCapture.mock.calls.length; i++) {
      await vi.advanceTimersByTimeAsync(10);
    }
    const settled = draws;
    await vi.advanceTimersByTimeAsync(1000);
    expect(draws).toBe(settled);
    // 首个受支持的容器是 mp4（avc1），播放器兼容性最好。
    expect(saveCapture).toHaveBeenCalledWith('Pixel 10 Pro', 'mp4', expect.any(ArrayBuffer));
  });
});
