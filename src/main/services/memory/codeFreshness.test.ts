import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readLatestCommitIso } from './codeFreshness';

const dirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-fresh-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('code freshness', () => {
  it('returns null outside a repository instead of guessing', () => {
    expect(readLatestCommitIso(tmpDir())).toBeNull();
    expect(readLatestCommitIso('')).toBeNull();
    expect(readLatestCommitIso(path.join(os.tmpdir(), 'definitely-not-a-repo-xyz'))).toBeNull();
  });
});
