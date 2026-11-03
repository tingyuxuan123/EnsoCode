import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { runCommand } from './process';

it('refuses a symlink encoded in a Git tree before checkout changes the design', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-unsafe-tree-'));
  const git = (...args: string[]) =>
    promisify(execFile)(
      'git',
      [`--git-dir=${path.join(dir, '.history')}`, `--work-tree=${dir}`, ...args],
      { cwd: dir }
    );
  try {
    await git('init', '--initial-branch=main');
    await writeFile(path.join(dir, 'keep.txt'), 'mine');
    await symlink('../outside', path.join(dir, 'linked'));
    await git('add', 'linked');
    await git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-m',
      'unsafe'
    );
    const sha = (await git('rev-parse', 'HEAD')).stdout.trim();
    await unlink(path.join(dir, 'linked'));
    const runner = path.resolve(
      import.meta.dirname,
      '../../../../resources/design/history-runner/runner.mjs'
    );
    await expect(
      runCommand(process.execPath, [runner, JSON.stringify({ cmd: 'checkout', dir, sha })], {
        cwd: dir,
        timeoutMs: 5000,
        captureStdout: true,
      })
    ).rejects.toMatchObject({ code: 'FAILED' });
    await expect(lstat(path.join(dir, 'linked'))).rejects.toThrow();
    expect(await readFile(path.join(dir, 'keep.txt'), 'utf8')).toBe('mine');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
