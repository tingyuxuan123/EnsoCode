import { type ChildProcess, spawn } from 'node:child_process';
import { win32 } from 'node:path';

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function killChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (hasExited(child)) return;
  try {
    child.kill(signal);
  } catch {
    // Best effort; the caller still waits for close, subject to its own bound.
  }
}

/** Owns one detached child. Windows never retries taskkill against a numeric PID. */
export function createProcessTreeKiller(child: ChildProcess) {
  const windows = process.platform === 'win32';
  let windowsResult: Promise<boolean> | undefined;
  let cancelTaskkill: (() => void) | undefined;

  return {
    kill(signal: NodeJS.Signals): void {
      const pid = child.pid;
      if (!windows) {
        // While awaiting close, descendants can still hold stdio and live in the
        // detached group even after the shell exited. Keep signaling the group.
        if (pid) {
          try {
            process.kill(-pid, signal);
            return;
          } catch {
            // The group could be unavailable; fall back to the owned child handle.
          }
        }
        killChild(child, signal);
        return;
      }

      // taskkill /F is already a force kill. Never start a second PID-based helper.
      windowsResult ??= new Promise<boolean>((resolve) => {
        if (hasExited(child)) return resolve(false);
        if (pid) {
          const root = process.env.SystemRoot;
          const systemRoot = root && /^[a-z]:[\\/]/i.test(root) ? root : 'C:\\Windows';
          try {
            const taskkill = spawn(
              win32.join(systemRoot, 'System32', 'taskkill.exe'),
              ['/PID', String(pid), '/T', '/F'],
              { shell: false, windowsHide: true, stdio: 'ignore' }
            );
            let finished = false;
            const complete = (ok: boolean, fallback = !ok) => {
              if (finished) return;
              finished = true;
              cancelTaskkill = undefined;
              if (fallback) killChild(child, 'SIGKILL');
              resolve(ok);
            };
            taskkill.on('error', () => complete(false));
            taskkill.once('exit', (code) => complete(code === 0));
            cancelTaskkill = () => {
              complete(false, false);
              killChild(taskkill, 'SIGKILL');
            };
            taskkill.unref();
            return;
          } catch {
            // Synchronous spawn failure follows the same handle-only fallback.
          }
        }
        killChild(child, 'SIGKILL');
        resolve(false);
      });
    },
    get windowsResult() {
      return windowsResult;
    },
    abandon(): void {
      cancelTaskkill?.();
    },
  };
}
