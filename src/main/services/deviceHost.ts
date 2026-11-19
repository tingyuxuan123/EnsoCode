import path from 'node:path';
import {
  app,
  BrowserWindow,
  MessageChannelMain,
  type MessagePortMain,
  utilityProcess,
  type WebContents,
} from 'electron';
import deviceHostPath from '../../device-host/index?modulePath';

type FromHost = { type: string; [key: string]: unknown };
type ToHost = Record<string, unknown> & { type: string };

/**
 * Main's side of the ported device host. The host itself is the utility process in
 * src/device-host; this class only forks it, hands ports to windows, and restarts it when it
 * crashes. Device authorization stays with the renderer surface and the agent gateway.
 */
export class DeviceHost {
  private child: Electron.UtilityProcess | null = null;
  private ready = false;
  private stopping = false;
  private failed = false;
  private crashes = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private readonly pending = new Map<number, WebContents>();
  private readonly calls = new Map<number, (answer: unknown) => void>();
  private nextCall = 1;

  start(): void {
    if (this.child || this.stopping || this.failed) return;
    const child = utilityProcess.fork(deviceHostPath, [], {
      serviceName: 'codekiln-device-host',
      stdio: 'pipe',
      env: {
        ...process.env,
        // The ported host writes its own rotating log; without a folder it would stay silent.
        KETTU_LOG_DIR: path.join(app.getPath('userData'), 'logs'),
        KETTU_LOG_LEVEL: 'info',
        // The host finds `agent-device` where this app's node_modules are, not where its own
        // bundle sits under out/main.
        ENSO_APP_REQUIRE_FROM: app.getAppPath(),
      },
    });
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) =>
      console.log(`[device-host] ${chunk.toString().trimEnd()}`)
    );
    child.stderr?.on('data', (chunk: Buffer) =>
      console.warn(`[device-host] ${chunk.toString().trimEnd()}`)
    );
    child.on('message', (message: unknown) => this.receive(message));
    child.on('exit', () => this.exited());
    child.postMessage({
      type: 'device-host:init',
      platform: process.platform,
      appVersion: app.getVersion(),
      nodeRuntime: { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } },
      dataDir: app.getPath('userData'),
      resourcesPath: app.isPackaged ? process.resourcesPath : null,
      allowDevices: false,
    } satisfies ToHost);
  }

  /** A window's port; the host queues it until it is ready. */
  connect(webContents: WebContents): void {
    if (webContents.isDestroyed()) return;
    this.start();
    if (!this.ready) {
      this.pending.set(webContents.id, webContents);
      return;
    }
    this.handOff(webContents);
  }

  private handOff(webContents: WebContents): void {
    const child = this.child;
    if (!child || webContents.isDestroyed()) return;
    const { port1, port2 } = new MessageChannelMain();
    const windowId = BrowserWindow.fromWebContents(webContents)?.id ?? -1;
    child.postMessage({ type: 'device-host:connect', windowId } satisfies ToHost, [port1]);
    webContents.postMessage('device-host:port', null, [port2 as MessagePortMain]);
  }

  post(message: ToHost): boolean {
    if (!this.child) return false;
    this.child.postMessage(message);
    return true;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    const child = this.child;
    if (!child) return;
    child.postMessage({ type: 'device-host:shutdown' });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 4000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private receive(raw: unknown): void {
    const message = raw as FromHost;
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'device-host:ready') {
      this.ready = true;
      this.crashes = 0;
      for (const [id, contents] of this.pending) {
        this.pending.delete(id);
        this.handOff(contents);
      }
      return;
    }
    if (message.type === 'device-host:answer') {
      const id = message.callId;
      if (typeof id === 'number') {
        this.calls.get(id)?.(message.answer);
        this.calls.delete(id);
      }
    }
  }

  private exited(): void {
    this.child = null;
    this.ready = false;
    for (const resolve of this.calls.values())
      resolve({ error: { code: 'unavailable', message: 'The device host stopped' } });
    this.calls.clear();
    if (this.stopping) return;
    this.crashes += 1;
    if (this.crashes >= 3) {
      this.failed = true;
      return;
    }
    this.restartTimer = setTimeout(() => this.start(), Math.min(8000, 500 * 2 ** this.crashes));
  }

  /** Runs one agent device call through the host; the renderer never calls this directly. */
  call(call: unknown, timeoutMs = 30_000): Promise<unknown> {
    this.start();
    const callId = this.nextCall++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.calls.delete(callId);
        resolve({ error: { code: 'failed', message: 'The device did not answer in time' } });
      }, timeoutMs);
      this.calls.set(callId, (answer) => {
        clearTimeout(timer);
        resolve(answer);
      });
      if (!this.post({ type: 'device-host:call', callId, call })) {
        clearTimeout(timer);
        this.calls.delete(callId);
        resolve({ error: { code: 'unavailable', message: 'The device host is not running' } });
      }
    });
  }

  setAllowDevices(allowed: boolean): void {
    this.post({ type: 'device-host:allow-devices', allowed });
  }
}

export const deviceHost = new DeviceHost();
