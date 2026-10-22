import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMAND_TIMEOUT_MS = 10_000;
const CERT_SHA1 = 'CB0DAF252F47DC25E63BCBE4F8D533A5B58844E7';

/** Kill the whole process group, including sudo's security child, rather than only timing out a Promise. */
export function runCleanupCommand(command, args, timeoutMs = COMMAND_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let timedOut = false;
    // A normal user's SIGKILL cannot kill a root-owned security child. Set an alarm
    // inside sudo before exec so even that process has its own hard deadline.
    const privileged = command === 'sudo' && args[0] === '-n';
    const actualArgs = privileged
      ? [
          '-n',
          '/usr/bin/perl',
          '-e',
          'alarm shift; exec @ARGV or exit 127;',
          String(Math.max(1, Math.ceil(timeoutMs / 1000))),
          ...args.slice(1),
        ]
      : args;
    const child = spawn(command, actualArgs, {
      detached: process.platform !== 'win32',
      stdio: 'ignore',
    });
    const timer = setTimeout(
      () => {
        timedOut = true;
        try {
          if (process.platform === 'win32') child.kill('SIGKILL');
          else if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          // The command may have exited just before the deadline.
        }
      },
      timeoutMs + (privileged ? 1000 : 0)
    );
    child.once('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, timedOut, pid: child.pid });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, timedOut, pid: child.pid });
    });
  });
}

/** CI-only cleanup: unlink secret files even if macOS security/trustd stops responding. */
export async function cleanupPersonalSigning({ tempDir, run = runCleanupCommand }) {
  if (!tempDir || !path.isAbsolute(tempDir) || path.resolve(tempDir) === path.parse(tempDir).root) {
    throw new Error('A dedicated absolute RUNNER_TEMP directory is required');
  }
  const p12 = path.join(tempDir, 'personal-signing.p12');
  const cert = path.join(tempDir, 'personal-signing.pem');
  const keychain = path.join(tempDir, 'personal-signing.keychain-db');
  const warnings = [];
  rmSync(p12, { force: true });
  try {
    if (existsSync(cert)) {
      const result = await run(
        'sudo',
        ['-n', 'security', 'remove-trusted-cert', '-d', cert],
        COMMAND_TIMEOUT_MS
      );
      if (!result.ok) warnings.push('Removing public certificate trust failed or timed out');
    }
    if (existsSync(keychain)) {
      const result = await run('security', ['delete-keychain', keychain], COMMAND_TIMEOUT_MS);
      if (!result.ok)
        warnings.push('Deleting the temporary keychain via security failed or timed out');
    }
  } finally {
    // System trust removal only affects a public certificate. Secret files must not survive it.
    for (const file of [
      p12,
      keychain,
      `${keychain}-shm`,
      `${keychain}-wal`,
      `${keychain}-journal`,
      cert,
    ]) {
      rmSync(file, { force: true });
    }
  }
  return warnings;
}

async function cleanupPublicCertificate() {
  const cert = path.resolve('build/personal-signing.pem');
  const commands = [
    ['-n', 'security', 'remove-trusted-cert', '-d', cert],
    ['-n', 'security', 'delete-certificate', '-Z', CERT_SHA1, '/Library/Keychains/System.keychain'],
  ];
  for (const args of commands) {
    const result = await runCleanupCommand('sudo', args);
    if (!result.ok)
      console.warn('::warning::Public verification certificate cleanup failed or timed out');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--public') await cleanupPublicCertificate();
    else {
      for (const warning of await cleanupPersonalSigning({ tempDir: process.env.RUNNER_TEMP })) {
        console.warn(`::warning::${warning}`);
      }
    }
  } catch {
    console.error('CI signing material cleanup failed');
    process.exitCode = 1;
  }
}
