import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    // Encode the symlink directly in the index: no filesystem symlink privilege is needed
    // (Windows), and the tree entry is exactly what a hostile history pack would carry.
    await writeFile(path.join(dir, 'target.txt'), '../outside');
    const blob = (await git('hash-object', '-w', path.join(dir, 'target.txt'))).stdout.trim();
    await rm(path.join(dir, 'target.txt'));
    await git('update-index', '--add', '--cacheinfo', `120000,${blob},linked`);
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
