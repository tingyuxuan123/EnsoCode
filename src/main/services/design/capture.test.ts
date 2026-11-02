import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ created: vi.fn(), calls: [] as string[], navigation: vi.fn() }));
vi.mock('electron', () => {
  class FakeWindow {
    private destroyed = false;
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      setZoomFactor: vi.fn(),
      executeJavaScript: vi.fn(async (script: string) => {
        mock.calls.push(script);
        if (script === 'bad-probe') throw new Error('bad');
        return true;
      }),
      debugger: {
        isAttached: () => true,
        attach: vi.fn(),
        sendCommand: vi.fn(async (method: string) => {
          if (method === 'Page.captureScreenshot') {
            mock.calls.push('capture');
            await new Promise((resolve) => setTimeout(resolve, 5));
            return { data: 'aW1hZ2U=' };
          }
          return {};
        }),
      },
    });
    constructor(options: unknown) {
      mock.created(this, options);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
    setContentSize() {}
    async loadURL(url: string) {
      mock.calls.push(url);
    }
  }
  return {
    BrowserWindow: FakeWindow,
    nativeImage: { createFromBuffer: () => ({ getSize: () => ({ width: 100, height: 100 }) }) },
    session: {
      fromPartition: () => ({
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        webRequest: { onBeforeRequest: mock.navigation },
        on: vi.fn(),
      }),
    },
  };
});

import { DesignCaptureService } from './capture';

afterEach(() => {
  mock.calls.length = 0;
  vi.clearAllMocks();
});
it('只能捕获已登记 engine，窗口沙箱无 preload，导航与新窗口均拦截', async () => {
  const service = new DesignCaptureService((_owner, id) =>
    id === 'engine' ? { port: 12345 } : null
  );
  try {
    await expect(
      service.request(1, {
        op: 'offscreen',
        engineId: 'unknown',
        path: '/',
        width: 100,
        height: 100,
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(mock.created).not.toHaveBeenCalled();
    expect(
      await service.request(1, {
        op: 'offscreen',
        engineId: 'engine',
        path: '/frame',
        width: 100,
        height: 100,
        sessionKey: 'key',
        format: 'png',
      })
    ).toMatchObject({ dataUrl: 'data:image/png;base64,aW1hZ2U=', scaleFactor: 1 });
    expect(mock.created.mock.calls[0]?.[1]).toMatchObject({
      show: false,
      webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
    });
    const policy = mock.navigation.mock.calls[0]?.[0];
    const callback = vi.fn();
    policy({ resourceType: 'mainFrame', url: 'https://evil.test' }, callback);
    expect(callback).toHaveBeenCalledWith({ cancel: true });
    policy({ resourceType: 'subFrame', url: 'file:///etc/passwd' }, callback);
    expect(callback).toHaveBeenLastCalledWith({ cancel: true });
  } finally {
    service.dispose();
  }
});
it('同 key 串行复用，CDP 截图，不调用 capturePage，release 幂等', async () => {
  const service = new DesignCaptureService(() => ({ port: 12345 }));
  try {
    const base = {
      op: 'offscreen',
      engineId: 'engine',
      path: '/',
      width: 100,
      height: 100,
      sessionKey: 'key',
    } as const;
    await Promise.all([
      service.request(1, { ...base, prepareScript: 'prepare-1' }),
      service.request(1, { ...base, prepareScript: 'prepare-2' }),
    ]);
    expect(mock.created).toHaveBeenCalledOnce();
    expect(mock.calls).toEqual([
      'http://127.0.0.1:12345/',
      'prepare-1',
      'capture',
      'prepare-2',
      'capture',
    ]);
    expect(await service.request(1, { op: 'release', sessionKey: 'key' })).toEqual({ ok: true });
    expect(await service.request(1, { op: 'release', sessionKey: 'key' })).toEqual({ ok: true });
  } finally {
    service.dispose();
  }
});
