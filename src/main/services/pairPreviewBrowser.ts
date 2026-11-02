import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import type { PairPreviewInput } from '@enso/pair';
import { BrowserWindow, session } from 'electron';
import type { PairPreviewBrowser, PairPreviewCandidate } from './pairPreview';
import {
  createPairPreviewNetworkPolicy,
  pairPreviewCsp,
  pairPreviewFsPath,
} from './pairPreviewPolicy';
import {
  createPairPreviewServerFiles,
  createPairPreviewStaticFiles,
  type PairPreviewStaticFiles,
} from './pairPreviewStatic';

const ACTION_TIMEOUT = 10_000;
const LOAD_TIMEOUT = 15_000;
const MAX_FRAME_CHARS = 700_000;
const JPEG_PREFIX = 'data:image/jpeg;base64,';
const KEY_CODES = {
  Enter: 13,
  Tab: 9,
  Escape: 27,
  Backspace: 8,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
};
// Fixed Main-owned security bootstrap, never generated content or phone-supplied JS.
// Network constructors can bypass webRequest (STUN/TURN/WebTransport); disable before any app script.
const NETWORK_BOOTSTRAP = `(() => {
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) {
    Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
  }
})();`;

export async function createPairPreviewBrowser(
  candidate: PairPreviewCandidate,
  viewport: { width: number; height: number }
): Promise<PairPreviewBrowser> {
  const lifetime = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Preview creation timed out'));
      lifetime.abort();
    }, LOAD_TIMEOUT);
  });
  try {
    return await Promise.race([
      openPairPreviewBrowser(candidate, viewport, lifetime.signal),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function openPairPreviewBrowser(
  candidate: PairPreviewCandidate,
  viewport: { width: number; height: number },
  creationSignal: AbortSignal
): Promise<PairPreviewBrowser> {
  const { width, height } = viewport;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 240 ||
    height < 240 ||
    width > 1280 ||
    height > 1280
  ) {
    throw new Error('Invalid preview viewport');
  }
  let files: PairPreviewStaticFiles | undefined;
  if (candidate.kind === 'html')
    files = await createPairPreviewStaticFiles(candidate.root, candidate.url);
  let policy = createPairPreviewNetworkPolicy(candidate.kind, files?.entryPath ?? candidate.url);
  if (candidate.kind === 'server') {
    const url = new URL(policy.entryUrl);
    if (!url.port || Number(url.port) < 1024)
      throw new Error('Explicit development server port required');
    const hosts = url.hostname === '[::1]' ? ['::1', '127.0.0.1'] : ['127.0.0.1', '::1'];
    let selected = false;
    for (const host of hosts) {
      if (await probeLoopback(host, Number(url.port), creationSignal)) {
        url.hostname = host === '::1' ? '[::1]' : host;
        selected = true;
        break;
      }
    }
    if (!selected) throw new Error('Development server unavailable');
    policy = createPairPreviewNetworkPolicy('server', url.href);
  }
  const serverFiles =
    candidate.kind === 'server'
      ? await createPairPreviewServerFiles(candidate.root, policy.entryUrl)
      : undefined;
  if (creationSignal.aborted) {
    files?.close();
    serverFiles?.close();
    throw new Error('Preview creation timed out');
  }
  // No persist: prefix: absolutely no BrowserHost/default-session cookies, preload or proxy state.
  const partition = `enso-pair-preview-${randomUUID()}`;
  const isolated = session.fromPartition(partition, { cache: false });
  let window: BrowserWindow | undefined;
  let closed = false;
  let navigationVersion = 0;
  let capturedVersion = -1;
  let pointer = { x: width / 2, y: height / 2 };
  const lifetime = new AbortController();
  const cleanups: Array<() => void> = [];
  const close = () => {
    if (closed) return;
    closed = true;
    capturedVersion = -1;
    lifetime.abort();
    const attempt = (cleanup: () => void) => {
      try {
        cleanup();
      } catch {
        /* A dead target cannot veto revocation. */
      }
    };
    files?.close();
    serverFiles?.close();
    for (const cleanup of cleanups.splice(0)) attempt(cleanup);
    attempt(() => isolated.webRequest.onBeforeRequest(null));
    attempt(() => isolated.webRequest.onBeforeSendHeaders(null));
    attempt(() => isolated.webRequest.onHeadersReceived(null));
    if (files) attempt(() => isolated.protocol.unhandle('http'));
    if (window && !window.isDestroyed()) {
      const contents = window.webContents;
      attempt(() => contents.stop());
      attempt(() => {
        if (contents.debugger.isAttached()) contents.debugger.detach();
      });
      attempt(() => window?.destroy()); // Never run page-controlled beforeunload while revoking authority.
    }
    void isolated.closeAllConnections().catch(() => {});
    void isolated.clearStorageData().catch(() => {});
    void isolated.clearCache().catch(() => {});
  };
  const bounded = async <T>(operation: Promise<T>, timeout = ACTION_TIMEOUT): Promise<T> => {
    if (closed) throw new Error('Preview closed');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error('Preview closed'));
      lifetime.signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        reject(new Error('Preview timed out'));
        close();
      }, timeout);
    });
    try {
      return await Promise.race([operation, cancelled]);
    } finally {
      clearTimeout(timer);
      lifetime.signal.removeEventListener('abort', abort);
    }
  };
  try {
    creationSignal.addEventListener('abort', close, { once: true });
    cleanups.push(() => creationSignal.removeEventListener('abort', close));
    const origin = new URL(policy.entryUrl).origin;
    // Preconnect and DNS hints can bypass ordinary request interception. Never use a system proxy.
    await bounded(
      isolated.setProxy({
        mode: 'fixed_servers',
        proxyRules: 'http://enso-preview-blackhole.invalid:1',
        proxyBypassRules:
          candidate.kind === 'server'
            ? `<-loopback>;${origin};${origin.replace(/^http:/, 'ws:')}`
            : '<-loopback>',
      }),
      LOAD_TIMEOUT
    );
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      if (closed || policy.allowsRequest(details.url, details.resourceType)) {
        callback({ cancel: closed });
        return;
      }
      if (!serverFiles || !pairPreviewFsPath(details.url, policy.entryUrl)) {
        callback({ cancel: true });
        return;
      }
      void bounded(
        serverFiles?.allowsRequest(details.url, details.resourceType) ?? Promise.resolve(false)
      ).then(
        (allowed) => callback({ cancel: closed || !allowed }),
        () => callback({ cancel: true })
      );
    });
    isolated.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
      const worker = Object.keys(details.requestHeaders).some(
        (key) => key.toLowerCase() === 'service-worker'
      );
      if (closed || worker || policy.allowsRequest(details.url, details.resourceType)) {
        callback({ cancel: closed || worker });
        return;
      }
      if (!serverFiles || !pairPreviewFsPath(details.url, policy.entryUrl)) {
        callback({ cancel: true });
        return;
      }
      void bounded(
        serverFiles?.allowsRequest(details.url, details.resourceType) ?? Promise.resolve(false)
      ).then(
        (allowed) => callback({ cancel: closed || !allowed }),
        () => callback({ cancel: true })
      );
    });
    isolated.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
      const headers = { ...details.responseHeaders };
      const existing = Object.keys(headers).find(
        (key) => key.toLowerCase() === 'content-security-policy'
      );
      // Multiple CSP headers intersect: preserve any stricter policy supplied by the app.
      const csp = pairPreviewCsp(policy.entryUrl);
      if (existing) headers[existing] = [...headers[existing], csp];
      else headers['Content-Security-Policy'] = [csp];
      headers['Permissions-Policy'] = [
        'camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), serial=(), bluetooth=(), hid=()',
      ];
      headers['X-DNS-Prefetch-Control'] = ['off'];
      callback({ cancel: closed, responseHeaders: headers });
    });
    const denyDownload = (event: Electron.Event) => event.preventDefault();
    isolated.on('will-download', denyDownload);
    cleanups.push(() => isolated.removeListener('will-download', denyDownload));
    if (files) isolated.protocol.handle('http', (request) => files.respond(request));

    window = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      webPreferences: {
        partition,
        offscreen: true,
        backgroundThrottling: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        webSecurity: true,
        webviewTag: false,
        navigateOnDragDrop: false,
        disableDialogs: true,
        spellcheck: false,
        devTools: false,
      },
    });
    const contents = window.webContents;
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const denyWebview = (event: Electron.Event) => event.preventDefault();
    const navigate = (event: Electron.Event, url: string) => {
      if (closed || !policy.allowsNavigation(url)) event.preventDefault();
    };
    const frameNavigate = (
      event: Electron.Event<Electron.WebContentsWillFrameNavigateEventParams>
    ) => {
      if (!event.isMainFrame || closed || !policy.allowsNavigation(event.url))
        event.preventDefault();
    };
    const invalidate = () => {
      navigationVersion++;
      capturedVersion = -1;
    };
    const unload = (event: Electron.Event) => event.preventDefault(); // Ignore page's unload veto.
    contents.on('will-attach-webview', denyWebview);
    contents.on('will-navigate', navigate);
    contents.on('will-frame-navigate', frameNavigate);
    contents.on('will-redirect', navigate);
    contents.on('did-start-navigation', invalidate);
    contents.on('did-navigate-in-page', invalidate);
    contents.on('will-prevent-unload', unload);
    contents.on('render-process-gone', close);
    window.on('closed', close);
    cleanups.push(() => {
      contents.removeListener('will-attach-webview', denyWebview);
      contents.removeListener('will-navigate', navigate);
      contents.removeListener('will-frame-navigate', frameNavigate);
      contents.removeListener('will-redirect', navigate);
      contents.removeListener('did-start-navigation', invalidate);
      contents.removeListener('did-navigate-in-page', invalidate);
      contents.removeListener('will-prevent-unload', unload);
      contents.removeListener('render-process-gone', close);
      window?.removeListener('closed', close);
    });
    const cdp = async (method: string, params: Record<string, unknown> = {}) => {
      if (closed) throw new Error('Preview closed');
      const version = navigationVersion;
      try {
        return await contents.debugger.sendCommand(method, params);
      } catch (error) {
        if (
          !closed &&
          version !== navigationVersion &&
          (method === 'Page.captureScreenshot' || method.startsWith('Input.'))
        )
          throw new Error('stale-frame');
        close();
        throw error;
      }
    };
    const message = (_event: Electron.Event, method: string) => {
      if (!closed && method === 'Page.javascriptDialogOpening') {
        void bounded(cdp('Page.handleJavaScriptDialog', { accept: false })).catch(close);
      }
    };
    contents.debugger.on('message', message);
    cleanups.push(() => contents.debugger.removeListener('message', message));
    const ready = new Promise<void>((resolve, reject) => {
      const onReady = () => {
        if (closed) {
          reject(new Error('Preview closed'));
          return;
        }
        try {
          // Attaching before first dom-ready can segfault Electron's Main process.
          contents.debugger.attach('1.3');
          void (async () => {
            await cdp('Page.enable');
            await cdp('Page.addScriptToEvaluateOnNewDocument', { source: NETWORK_BOOTSTRAP });
            await cdp('Page.setInterceptFileChooserDialog', { enabled: true });
            await cdp('Emulation.setDeviceMetricsOverride', {
              width,
              height,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
            resolve();
          })().catch(reject);
        } catch (error) {
          reject(error);
        }
      };
      contents.once('dom-ready', onReady);
      cleanups.push(() => contents.removeListener('dom-ready', onReady));
    });
    // Bootstrap on a trusted empty document; no generated code runs during the pre-attach gap.
    await bounded(
      (async () => {
        await Promise.all([ready, window.loadURL('about:blank')]);
        await contents.loadURL(policy.entryUrl);
      })(),
      LOAD_TIMEOUT
    );

    let queue: Promise<unknown> = Promise.resolve();
    const serial = <T>(action: () => Promise<T>): Promise<T> => {
      const result = bounded(
        queue.then(() => {
          if (closed) throw new Error('Preview closed');
          return action();
        })
      );
      queue = result.catch(() => {});
      return result;
    };
    const capture = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await captureOnce();
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'stale-frame' || attempt === 1)
            throw error;
        }
      }
      throw new Error('stale-frame');
    };
    const captureOnce = async () => {
      capturedVersion = -1;
      if (contents.isLoadingMainFrame()) {
        await new Promise<void>((resolve, reject) => {
          const loaded = () => {
            cleanup();
            resolve();
          };
          const aborted = () => {
            cleanup();
            reject(new Error('Preview closed'));
          };
          const cleanup = () => {
            contents.removeListener('did-stop-loading', loaded);
            lifetime.signal.removeEventListener('abort', aborted);
          };
          contents.once('did-stop-loading', loaded);
          lifetime.signal.addEventListener('abort', aborted, { once: true });
          if (!contents.isLoadingMainFrame()) loaded();
        });
      }
      const version = navigationVersion;
      for (const quality of [65, 45, 25, 10]) {
        const result: unknown = await cdp('Page.captureScreenshot', {
          format: 'jpeg',
          quality,
          captureBeyondViewport: false,
          fromSurface: true,
        });
        if (closed) throw new Error('Preview closed');
        if (version !== navigationVersion) throw new Error('stale-frame');
        if (
          !result ||
          typeof result !== 'object' ||
          !('data' in result) ||
          typeof result.data !== 'string' ||
          !result.data
        )
          throw new Error('Invalid screenshot');
        if (result.data.length + JPEG_PREFIX.length > MAX_FRAME_CHARS) continue;
        capturedVersion = version;
        return {
          width,
          height,
          dataUrl: JPEG_PREFIX + result.data,
          title: contents.getTitle().slice(0, 300),
        };
      }
      throw new Error('too-large');
    };
    return {
      close,
      capture: () => serial(capture),
      input: (input) =>
        serial(async () => {
          if (capturedVersion !== navigationVersion) throw new Error('stale-frame');
          validateInput(input, width, height);
          const version = navigationVersion;
          const dispatch = async (method: string, params: Record<string, unknown>) => {
            if (version !== navigationVersion) throw new Error('stale-frame');
            await cdp(method, params);
          };
          if (input.kind === 'click') {
            pointer = { x: input.x, y: input.y };
            await dispatch('Input.dispatchMouseEvent', {
              type: 'mousePressed',
              ...pointer,
              button: 'left',
              buttons: 1,
              clickCount: 1,
            });
            await dispatch('Input.dispatchMouseEvent', {
              type: 'mouseReleased',
              ...pointer,
              button: 'left',
              buttons: 0,
              clickCount: 1,
            });
          } else if (input.kind === 'scroll') {
            await dispatch('Input.dispatchMouseEvent', {
              type: 'mouseWheel',
              ...pointer,
              deltaX: input.deltaX,
              deltaY: input.deltaY,
            });
          } else if (input.kind === 'text') {
            await dispatch('Input.insertText', { text: input.text });
          } else {
            const common = {
              key: input.key,
              code: input.key,
              windowsVirtualKeyCode: KEY_CODES[input.key],
            };
            await dispatch('Input.dispatchKeyEvent', {
              type: 'keyDown',
              ...common,
              ...(input.key === 'Enter' ? { text: '\r' } : {}),
            });
            await dispatch('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
          }
        }),
      refresh: () =>
        serial(async () => {
          invalidate();
          try {
            await contents.loadURL(policy.entryUrl);
          } catch (error) {
            close();
            throw error;
          }
        }),
    };
  } catch (error) {
    close();
    throw error;
  }
}

/** Two numeric loopback addresses at the one approved port; no DNS or port discovery. */
function probeLoopback(host: string, port: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let finished = false;
    const finish = (connected: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      socket.destroy();
      resolve(connected);
    };
    const aborted = () => finish(false);
    const timer = setTimeout(() => finish(false), 500);
    socket.once('connect', () => finish(true));
    socket.on('error', () => finish(false));
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

function validateInput(input: PairPreviewInput, width: number, height: number): void {
  switch (input.kind) {
    case 'click':
      if (
        !Number.isFinite(input.x) ||
        !Number.isFinite(input.y) ||
        input.x < 0 ||
        input.y < 0 ||
        input.x >= width ||
        input.y >= height
      )
        throw new Error('Invalid preview coordinates');
      return;
    case 'scroll':
      if (
        ![input.deltaX, input.deltaY].every(
          (value) => Number.isFinite(value) && Math.abs(value) <= 2000
        )
      )
        throw new Error('Invalid preview scroll');
      return;
    case 'text':
      if (typeof input.text !== 'string' || input.text.length > 4096)
        throw new Error('Invalid preview text');
      return;
    case 'key':
      if (!Object.hasOwn(KEY_CODES, input.key)) throw new Error('Invalid preview key');
      return;
    default:
      throw new Error('Invalid preview input');
  }
}
