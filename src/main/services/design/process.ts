import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { DesignServiceError } from './errors';

export class OutputTail {
  private bytes: Buffer = Buffer.alloc(0);
  constructor(private readonly limit = 65536) {}
  append(chunk: Buffer): void {
    this.bytes = Buffer.from(Buffer.concat([this.bytes, chunk]).subarray(-this.limit));
  }
  text(): string {
    let start = 0;
    while (start < this.bytes.length && (this.bytes[start] & 0xc0) === 0x80) start++;
    return this.bytes.subarray(start).toString('utf8');
  }
}
export function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Port allocation failed'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}
export function commandEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'TMPDIR',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'LANG',
    'LC_ALL',
    'TERM',
    'NO_COLOR',
    'npm_config_registry',
    'npm_config_cache',
    'npm_config_prefix',
    'npm_config_userconfig',
  ])
    if (process.env[key] !== undefined) env[key] = process.env[key];
  return { ...env, ...extra };
}
export function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    /* already gone */
  }
}
export async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      killGroup(child, 'SIGKILL');
    }, 3000);
    timer.unref();
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolve();
    });
    killGroup(child, 'SIGTERM');
    if (!child.pid) {
      clearTimeout(timer);
      resolve();
    }
  });
}
/** Fixed command callers only; no shell and no arbitrary renderer-controlled executable. */
export async function runCommand(
  file: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs: number;
    onOutput?: (tail: string) => void;
    onChild?: (child: ChildProcess) => void;
    captureStdout?: boolean;
    stdoutLimitBytes?: number;
  }
): Promise<string> {
  const child = spawn(file, args, {
    cwd: options.cwd,
    env: commandEnvironment(options.env),
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  options.onChild?.(child);
  const tail = new OutputTail();
  const stdout: Buffer[] = [];
  let stdoutBytes = 0;
  let overflow = false;
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk: Buffer) => {
      tail.append(chunk);
      options.onOutput?.(tail.text());
      if (stream === child.stdout && options.captureStdout && !overflow) {
        stdoutBytes += chunk.length;
        if (stdoutBytes > (options.stdoutLimitBytes ?? 32 * 1024 * 1024)) {
          overflow = true;
          void stopChild(child);
        } else stdout.push(chunk);
      }
    });
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void stopChild(child);
    }, options.timeoutMs);
    timer.unref();
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) reject(new DesignServiceError('TIMEOUT', 'Design command timed out'));
      else if (overflow)
        reject(new DesignServiceError('TOO_LARGE', 'Design script output exceeds limit'));
      else if (code === 0)
        resolve(options.captureStdout ? Buffer.concat(stdout).toString('utf8') : tail.text());
      else
        reject(
          new DesignServiceError(
            'FAILED',
            `Design command exited ${code ?? signal}\n${tail.text()}`
          )
        );
    });
  });
}
