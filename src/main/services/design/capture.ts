import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { DesignCaptureRequest, DesignCaptureResponse } from '@shared/types/design';
import { BrowserWindow, nativeImage, session } from 'electron';
import { encodeCapturedImage, prefersNativeCapture } from './captureImage';
import { DesignServiceError, record } from './errors';
import { capturePath } from './parsers';

type Offscreen = Extract<DesignCaptureRequest, { op: 'offscreen' }>;
interface CaptureSession {
  owner: number;
  key: string;
  win: BrowserWindow;
  chain: Promise<unknown>;
  loaded: string | null;
  origin: string;
  idle?: NodeJS.Timeout;
  queued: number;
}
export class DesignCaptureService {
  private readonly sessions = new Map<string, CaptureSession>();
  private readonly closed = new Set<number>();
  private disposed = false;
  constructor(private readonly engine: (owner: number, id: string) => { port: number } | null) {}
  private destroy(s: CaptureSession): void {
    if (s.idle) clearTimeout(s.idle);
    if (this.sessions.get(s.key) === s) this.sessions.delete(s.key);
    if (!s.win.isDestroyed()) s.win.destroy();
  }
  private create(owner: number, key: string, request: Offscreen, origin: string): CaptureSession {
    if (this.sessions.size >= 4) {
      const idle = [...this.sessions.values()].find((s) => !s.queued);
      if (idle) this.destroy(idle);
      else throw new DesignServiceError('FAILED', 'At most 4 design capture sessions can run');
    }
    const isolated = session.fromPartition(`design-capture-${randomUUID()}`, { cache: false });
    isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    const win = new BrowserWindow({
      show: false,
      frame: false,
      width: request.width,
      height: request.height,
      useContentSize: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        session: isolated,
      },
    });
    const s: CaptureSession = {
      owner,
      key,
      win,
      chain: Promise.resolve(),
      loaded: null,
      origin,
      queued: 0,
    };
    const allowed = (raw: string) => {
      try {
        return new URL(raw).origin === s.origin;
      } catch {
        return false;
      }
    };
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
      if (!allowed(url)) event.preventDefault();
    });
    win.webContents.on('will-frame-navigate', (event) => {
      if (!allowed(event.url)) event.preventDefault();
    });
    win.webContents.on('will-redirect', (event, url) => {
      if (!allowed(url)) event.preventDefault();
    });
    // Block cross-origin document requests as well: loadURL itself bypasses will-navigate.
    isolated.webRequest.onBeforeRequest((details, callback) =>
      callback({
        cancel:
          (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') &&
          !allowed(details.url),
      })
    );
    isolated.on('will-download', (event) => event.preventDefault());
    win.webContents.on('render-process-gone', () => this.destroy(s));
    this.sessions.set(key, s);
    return s;
  }
  async request(owner: number, request: DesignCaptureRequest): Promise<DesignCaptureResponse> {
    if (request.op === 'release') {
      const s = this.sessions.get(`${owner}:${request.sessionKey}`);
      if (s) this.destroy(s);
      return { ok: true };
    }
    if (this.disposed || this.closed.has(owner))
      throw new DesignServiceError('ABORTED', 'Design owner closed');
    const registered = this.engine(owner, request.engineId);
    if (!registered || !capturePath(request.path))
      throw new DesignServiceError(
        'PERMISSION_DENIED',
        'Capture requires a registered design engine'
      );
    const origin = `http://127.0.0.1:${registered.port}`;
    const key = `${owner}:${request.sessionKey ?? randomUUID()}`;
    let s = this.sessions.get(key);
    if (s?.win.isDestroyed()) {
      this.destroy(s);
      s = undefined;
    }
    s ??= this.create(owner, key, request, origin);
    if (s.idle) clearTimeout(s.idle);
    s.queued++;
    const entry = s;
    const next = s.chain.catch(() => {}).then(() => this.perform(entry, request));
    s.chain = next;
    try {
      return await next;
    } catch (error) {
      this.destroy(entry);
      throw error;
    } finally {
      entry.queued--;
      if (!request.sessionKey) this.destroy(entry);
      else if (!entry.win.isDestroyed() && !entry.queued) {
        entry.idle = setTimeout(() => this.destroy(entry), 60000);
        entry.idle.unref();
      }
    }
  }
  private async perform(s: CaptureSession, request: Offscreen): Promise<DesignCaptureResponse> {
    const registered = this.engine(s.owner, request.engineId);
    if (!registered || s.win.isDestroyed())
      throw new DesignServiceError('PERMISSION_DENIED', 'Design engine or capture session closed');
    const origin = `http://127.0.0.1:${registered.port}`;
    const url = `${origin}${request.path}`;
    const deadline = Date.now() + (request.timeoutMs ?? 20000);
    const bounded = <T>(promise: Promise<T>, end = deadline): Promise<T> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new DesignServiceError('TIMEOUT', 'Design capture timed out')),
          Math.max(0, end - Date.now())
        );
        timer.unref();
        promise.then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          }
        );
      });
    const win = s.win;
    const contents = win.webContents;
    win.setContentSize(request.width, request.height);
    contents.setZoomFactor(1);
    s.origin = origin;
    if (s.loaded !== url) {
      s.loaded = null;
      await bounded(win.loadURL(url));
      s.loaded = url;
    }
    // Never attach before the first dom-ready (pairPreviewBrowser's Electron crash guard).
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
    await bounded(contents.debugger.sendCommand('Page.enable'));
    if (request.prepareScript)
      await bounded(contents.executeJavaScript(request.prepareScript, true));
    if (request.readyExpression) {
      const script = `(()=>{try{return !!(${request.readyExpression})}catch{return false}})()`;
      while (!(await bounded(contents.executeJavaScript(script, true)))) await bounded(delay(100));
    }
    if (request.settleMs) await bounded(delay(request.settleMs));
    let probe: unknown;
    if (request.probeScript) {
      try {
        const raw: unknown = await bounded(
          contents.executeJavaScript(
            `(()=>{try{return JSON.stringify((${request.probeScript}))??null}catch{return null}})()`,
            true
          ),
          Math.min(deadline, Date.now() + 2000)
        );
        if (typeof raw === 'string') probe = JSON.parse(raw);
      } catch {
        /* Optional JSON-only probe must not reject a screenshot. */
      }
    }
    const format = request.format ?? 'jpeg';
    let data: string;
    if (prefersNativeCapture()) {
      data = encodeCapturedImage(await bounded(contents.capturePage()), format, request.quality);
    } else {
      const screenshot: unknown = await bounded(
        contents.debugger.sendCommand('Page.captureScreenshot', {
          format,
          ...(format === 'jpeg'
            ? { quality: Math.max(1, Math.round((request.quality ?? 0.92) * 100)) }
            : {}),
          captureBeyondViewport: false,
          fromSurface: true,
        })
      );
      if (!record(screenshot) || typeof screenshot.data !== 'string')
        throw new DesignServiceError('FAILED', 'Capture returned no image');
      data = screenshot.data;
    }
    const scaleFactor =
      nativeImage.createFromBuffer(Buffer.from(data, 'base64')).getSize().width / request.width;
    return {
      ok: true,
      dataUrl: `data:image/${format};base64,${data}`,
      scaleFactor,
      ...(probe === undefined ? {} : { probe }),
    };
  }
  releaseOwner(owner: number): void {
    this.closed.add(owner);
    for (const s of [...this.sessions.values()]) if (s.owner === owner) this.destroy(s);
  }
  dispose(): void {
    this.disposed = true;
    for (const s of [...this.sessions.values()]) this.destroy(s);
  }
}
