// The environment the device host runs its tools in: the login shell's, resolved once the way VS
// Code does it, because apps started from the Dock or a desktop launcher get a minimal PATH.
//
// This is the device host's own copy of what Kettu keeps in `src/agent-host/shell-env.ts`: only
// what the device host calls is carried over, so the host process does not depend on the agent
// host's environment service, proxy settings or Node.js probe.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { NodeRuntime } from '@shared/host-control';
import type { Platform } from '@shared/platform';
import { quotePosix } from './quote';

export type Env = Record<string, string | undefined>;

export const SHELL_ENV_TIMEOUT_MS = 10_000;

const MAX_PROBE_OUTPUT = 8 * 1024 * 1024;

export function defaultShell(platform: Platform, env: Env): string {
  const shell = env.SHELL;
  if (shell && path.posix.isAbsolute(shell)) return shell;
  return platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
}

/**
 * Arguments that make `shell` print the environment between two markers through `node`, the
 * program that runs as Node.js. csh and tcsh accept `-l` only as their sole flag, so they run
 * interactive without it (`-ic`), as in VS Code; pwsh and nu need their own syntax.
 */
export function shellProbeArgs(shell: string, node: string, mark: string): string[] {
  const name = path.posix.basename(shell).replace(/\.exe$/i, '');
  const exe = quotePosix(node);
  if (/^(?:pwsh|powershell)(?:-preview)?$/.test(name)) {
    const ps = `'${node.replace(/'/g, "''")}'`;
    return [
      '-Login',
      '-Command',
      `& ${ps} -p '''${mark}'' + JSON.stringify(process.env) + ''${mark}'''`,
    ];
  }
  const command = `${name === 'nu' ? '^' : ''}${exe} -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`;
  if (name === 'tcsh' || name === 'csh') return ['-ic', command];
  return ['-i', '-l', '-c', command];
}

/** The environment printed between the markers, or null when the output has none. */
export function parseProbeOutput(stdout: string, mark: string): Env | null {
  const start = stdout.indexOf(mark);
  if (start < 0) return null;
  const end = stdout.indexOf(mark, start + mark.length);
  if (end < 0) return null;
  try {
    const parsed: unknown = JSON.parse(stdout.slice(start + mark.length, end));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const env: Env = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') env[key] = value;
    }
    return env;
  } catch {
    return null;
  }
}

/** Removes Electron's variables, which would make an agent's Node.js behave like Electron. */
export function withoutElectronVars(env: Env, platform: Platform): Env {
  const out: Env = {};
  for (const [key, value] of Object.entries(env)) {
    const upper = platform === 'win32' ? key.toUpperCase() : key;
    if (upper.startsWith('ELECTRON_') || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export interface ShellEnvironment {
  env: Env;
  shell: string | null;
  durationMs: number;
}

export interface ResolveOptions {
  platform: Platform;
  nodeRuntime: NodeRuntime;
  baseEnv: Env;
  timeoutMs?: number;
}

function runProbe(shell: string, options: ResolveOptions, timeoutMs: number): Promise<Env> {
  const mark = randomBytes(8).toString('hex');
  const args = shellProbeArgs(shell, options.nodeRuntime.command, mark);
  return new Promise((resolve, reject) => {
    const child = spawn(shell, args, {
      // No controlling terminal, so an interactive profile cannot stop the probe for input.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...options.baseEnv, ...options.nodeRuntime.env },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error: Error | null, env?: Env): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(env!);
    };
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      finish(new Error(`the login shell did not answer within ${timeoutMs / 1000} s`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (data: string) => {
      if (stdout.length < MAX_PROBE_OUTPUT) stdout += data;
    });
    child.stderr.setEncoding('utf8').on('data', (data: string) => {
      if (stderr.length < 64 * 1024) stderr += data;
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code, signal) => {
      const env = parseProbeOutput(stdout, mark);
      if (env) return finish(null, env);
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      const detail = stderr.trim().split('\n').slice(-3).join(' ');
      finish(
        new Error(
          `${path.posix.basename(shell)} printed no environment (${reason})${detail ? `: ${detail}` : ''}`
        )
      );
    });
  });
}

/**
 * The login shell's environment on macOS and Linux, and the inherited one on Windows. On timeout or
 * failure the inherited environment is used, since a device tool run with a minimal PATH fails in
 * ways the user cannot see.
 */
export async function resolveShellEnvironment(options: ResolveOptions): Promise<ShellEnvironment> {
  const started = Date.now();
  const { platform, baseEnv } = options;
  if (platform === 'win32') {
    return {
      env: withoutElectronVars(baseEnv, platform),
      shell: null,
      durationMs: 0,
    };
  }
  const shell = defaultShell(platform, baseEnv);
  try {
    const env = await runProbe(shell, options, options.timeoutMs ?? SHELL_ENV_TIMEOUT_MS);
    return { env: withoutElectronVars(env, platform), shell, durationMs: Date.now() - started };
  } catch {
    return { env: withoutElectronVars(baseEnv, platform), shell, durationMs: Date.now() - started };
  }
}
