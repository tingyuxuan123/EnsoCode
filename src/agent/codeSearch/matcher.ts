import { spawn } from 'node:child_process';
import { check } from './safety';

export interface MatchResult {
  lines: number[];
  partial: boolean;
  notice?: string;
  denied?: boolean;
}

interface NativeResult {
  code: number | null;
  stdout: string;
  stderr: string;
  stopped?: 'output' | 'unavailable';
}

const DENIED = '[DENIED] Native regex matcher unavailable or exceeded its safety budget.';

/** Only numeric native prefixes are consumed. Content and filenames never come from rg. */
export async function matchLines(
  pattern: string,
  input: string,
  signal: AbortSignal
): Promise<MatchResult> {
  check(signal);
  const expires = Date.now() + 5000;
  let rgPath: string;
  try {
    const native = await import('@vscode/ripgrep');
    rgPath = native.rgPath.replace(/\.asar([\\/])/, '.asar.unpacked$1');
  } catch {
    check(signal);
    return { lines: [], partial: true, denied: true, notice: DENIED };
  }
  check(signal);
  const run = (literal: boolean): Promise<NativeResult> => {
    check(signal);
    if (Date.now() >= expires) {
      return Promise.resolve({ code: null, stdout: '', stderr: '', stopped: 'unavailable' });
    }
    return new Promise((resolve) => {
      const args = [
        '--no-config',
        '--text',
        '--encoding=none',
        '--no-filename',
        '--line-number',
        '--color=never',
        '--max-columns=1',
        '--regex-size-limit=1M',
        '--dfa-size-limit=8M',
        ...(literal ? ['-F'] : []),
        '-e',
        pattern,
        '-',
      ];
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(rgPath, args, { env: {}, shell: false, windowsHide: true, stdio: 'pipe' });
      } catch {
        resolve({ code: null, stdout: '', stderr: '', stopped: 'unavailable' });
        return;
      }
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outBytes = 0;
      let errBytes = 0;
      let stopped: NativeResult['stopped'];
      // spawn may return a child without pipes (EMFILE/ENFILE) before emitting error.
      child.on('error', () => {
        stopped = 'unavailable';
      });
      const stop = (reason: NativeResult['stopped']) => {
        if (!stopped) {
          stopped = reason;
          child.kill('SIGKILL');
        }
      };
      const abort = () => stop('unavailable');
      const timer = setTimeout(() => stop('unavailable'), Math.max(0, expires - Date.now()));
      signal.addEventListener('abort', abort, { once: true });
      // close, not exit/error/abort, is the concurrency-slot release boundary.
      child.once('close', (code) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        resolve({
          code,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          stopped,
        });
      });
      if (!child.stdin || !child.stdout || !child.stderr) {
        stop('unavailable');
        return;
      }
      child.stdout.on('data', (data: Buffer) => {
        if (stopped) return;
        const chunk = Buffer.from(data);
        const remaining = 128 * 1024 - outBytes;
        stdout.push(chunk.subarray(0, remaining));
        outBytes += Math.min(chunk.length, remaining);
        if (chunk.length > remaining) stop('output');
      });
      child.stderr.on('data', (data: Buffer) => {
        if (stopped) return;
        const chunk = Buffer.from(data);
        const remaining = 4 * 1024 - errBytes;
        stderr.push(chunk.subarray(0, remaining));
        errBytes += Math.min(chunk.length, remaining);
        if (chunk.length > remaining) stop('unavailable');
      });
      child.stdin.on('error', () => {
        /* EPIPE is expected when rg exits before consuming input. */
      });
      if (signal.aborted) abort();
      else child.stdin.end(input);
    });
  };
  let result = await run(false);
  check(signal);
  let notice: string | undefined;
  if (
    !result.stopped &&
    result.code === 2 &&
    /regex (?:parse|syntax) error|compiled regex exceeds|size limit/i.test(result.stderr)
  ) {
    notice = '[NOTICE] Invalid or oversized regex; retried once as literal (-F).';
    result = await run(true);
    check(signal);
  }
  if (
    result.stopped === 'unavailable' ||
    (!result.stopped && result.code !== 0 && result.code !== 1)
  ) {
    return { lines: [], partial: true, denied: true, notice: DENIED };
  }
  const lines: number[] = [];
  for (const line of result.stdout.split('\n').slice(0, -1)) {
    const prefix = /^([1-9][0-9]*):/.exec(line);
    if (prefix && Number.isSafeInteger(Number(prefix[1]))) lines.push(Number(prefix[1]));
  }
  return { lines, partial: result.stopped === 'output', ...(notice ? { notice } : {}) };
}
