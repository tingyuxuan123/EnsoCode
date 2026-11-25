import { randomUUID } from 'node:crypto';
import { RotatingFile } from '@shared/log/rotating-file';
import { AGENT_SERVICE_ATTEMPT_PREFIX } from '@shared/resources';
import type { Details } from 'electron';

const MAX_WORKER_ATTEMPTS = 32;
type WorkerAttempt = { serviceName: string; pid: number | null; log: RotatingFile };
const attempts = new Map<string, WorkerAttempt>();
let file: { dir: string; log: RotatingFile } | undefined;

function write(attempt: WorkerAttempt, details: Record<string, unknown>): void {
  const { serviceName, pid, log } = attempt;
  log.write(
    `${JSON.stringify({ time: new Date().toISOString(), serviceName, pid, ...details })}\n`,
    true
  );
}

export function beginAgentWorkerDiagnostics(dir: string) {
  if (file?.dir !== dir) {
    file = {
      dir,
      log: new RotatingFile({ dir, name: 'agent-worker-exits', maxBytes: 256 * 1024, files: 3 }),
    };
  }
  // child-process-gone has no PID and can arrive after the next worker starts. Electron echoes
  // the fork's display name in details.name; give each fork its own name, not just a shared label.
  const serviceName = `${AGENT_SERVICE_ATTEMPT_PREFIX}${randomUUID()}`;
  const attempt: WorkerAttempt = { serviceName, pid: null, log: file.log };
  attempts.set(serviceName, attempt);
  if (attempts.size > MAX_WORKER_ATTEMPTS) {
    const oldest = attempts.keys().next().value;
    if (oldest) attempts.delete(oldest);
  }
  return {
    serviceName,
    spawned(pid: number | undefined) {
      attempt.pid = pid ?? null;
    },
    exited(exitCode: number, stopRequested: boolean) {
      write(attempt, { event: 'exit', exitCode: exitCode ?? null, stopRequested });
    },
  };
}

export function recordAgentWorkerGone(details: Details): void {
  if (details.type !== 'Utility') return;
  const attempt = attempts.get(details.name ?? '') ?? attempts.get(details.serviceName ?? '');
  if (!attempt) return;
  // On POSIX the app event may report raw waitpid status, unlike the worker's exit callback.
  write(attempt, {
    event: 'child-process-gone',
    reason: details.reason,
    electronExitCode: details.exitCode,
  });
}
