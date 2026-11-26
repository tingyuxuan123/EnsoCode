import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Explicitly trusted Node execution, not an OS sandbox. No inherited model or MCP credentials. */
export async function runAuthoringTests(
  directory: string,
  signal?: AbortSignal
): Promise<{ passed: boolean; output: string }> {
  const tests = (await readdir(join(directory, 'test'), { withFileTypes: true })).filter(
    (file) => file.isFile() && /\.(?:test|spec)\.m?js$/.test(file.name)
  );
  if (!tests.length) throw Error('没有可运行的 test/*.test.mjs；请先添加真实行为测试');
  const home = join(directory, '.test-home');
  await mkdir(home, { mode: 0o700 });
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(
      process.execPath,
      ['--test', ...tests.map((file) => join('test', file.name))],
      {
        cwd: directory,
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          PATH: process.env.PATH ?? '',
          HOME: home,
          USERPROFILE: home,
          TMPDIR: home,
          TMP: home,
          TEMP: home,
          SystemRoot: process.env.SystemRoot ?? '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      }
    );
    let output = '',
      timedOut = false;
    const stop = () => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* exited */
      }
    };
    const aborted = () => stop();
    signal?.addEventListener('abort', aborted, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, 60000);
    timer.unref();
    const receive = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-14000);
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
    };
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (code) => {
      stop();
      cleanup();
      resolve({
        passed: code === 0 && !signal?.aborted && !timedOut,
        output: `${timedOut ? '测试超过60秒，进程组已终止\n' : ''}${signal?.aborted ? '已取消\n' : ''}${output}`,
      });
    });
  });
}
