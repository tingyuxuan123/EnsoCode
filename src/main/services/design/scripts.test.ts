import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Script } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('./appPaths', () => ({ getDesignPaths: vi.fn() }));

import { runCommand } from './process';
import { SCAN_SCRIPT } from './scripts';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
it('固定脚本本身语法合法，不触发 electron-vite 文本 CJS shim 误判', async () => {
  expect(() => new Script(SCAN_SCRIPT)).not.toThrow();
  const source = await readFile(path.join(import.meta.dirname, 'scripts.ts'), 'utf8');
  // electron-vite esmShimPlugin scans raw text, including child-script strings. Its
  // import regex can mistake i18n's "Confirm import" for an import and splice a shim into a string.
  expect(source).not.toMatch(/__filename|__dirname|require\(|require\.resolve\(/);
});
it('真实子进程扫描 TSX，仅回报语法错误且不修改源码', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-syntax-'));
  temps.push(dir);
  await mkdir(path.join(dir, 'frames'));
  await mkdir(path.join(dir, 'components'));
  const broken = 'export default () => <div><span></div>';
  await writeFile(path.join(dir, 'frames/bad.tsx'), broken);
  await writeFile(path.join(dir, 'components/good.tsx'), 'export default () => <div/>');
  const fromVite = createRequire(createRequire(import.meta.url).resolve('vite/package.json'));
  const output = await runCommand(process.execPath, ['-e', SCAN_SCRIPT], {
    cwd: dir,
    env: { VETD_DIR: dir, VETD_ESBUILD: fromVite.resolve('esbuild'), VETD_FILES: '[]' },
    timeoutMs: 5000,
    captureStdout: true,
  });
  expect(JSON.parse(output)).toEqual([
    expect.objectContaining({ file: 'frames/bad.tsx', line: 1, message: expect.any(String) }),
  ]);
  expect(await readFile(path.join(dir, 'frames/bad.tsx'), 'utf8')).toBe(broken);
});
