import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Resolve the real POSIX shell used by integration fixtures, including Git for Windows. */
export function posixShell(): string {
  if (process.platform !== 'win32') return '/bin/sh';
  const located = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  const execPath = located.status === 0 ? located.stdout.trim() : '';
  const candidates = [
    ...(execPath ? [path.resolve(execPath, '../../../bin/sh.exe')] : []),
    ...[process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
      .filter((dir): dir is string => Boolean(dir))
      .map((dir) => path.join(dir, 'Git/bin/sh.exe')),
  ];
  const shell = candidates.find((candidate) => existsSync(candidate));
  if (!shell) throw new Error('POSIX integration fixtures require Git for Windows (sh.exe)');
  return shell;
}

export function bashPath(value: string): string {
  if (process.platform !== 'win32') return value;
  return value
    .replaceAll('\\', '/')
    .replace(/^([a-z]):\//i, (_, drive: string) => `/${drive.toLowerCase()}/`);
}

export function bashTestPath(): string {
  return `${bashPath(path.dirname(process.execPath))}:/usr/bin:/bin`;
}
