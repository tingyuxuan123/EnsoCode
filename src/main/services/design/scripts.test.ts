import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Script } from 'node:vm';
import { strToU8, zipSync } from 'fflate';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('./appPaths', () => ({ getDesignPaths: vi.fn() }));

import { runCommand } from './process';
import { SCAN_SCRIPT, validateHistoryPack } from './scripts';

const temps: string[] = [];
it('standalone runner ships the exact bounded decoder source used by Main and Renderer', async () => {
  const root = path.resolve(import.meta.dirname, '../../../..');
  expect(
    await readFile(path.join(root, 'resources/design/history-runner/source/archive.ts'), 'utf8')
  ).toBe(await readFile(path.join(root, 'src/shared/design/archive.ts'), 'utf8'));
});
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
it('history pack validation checks real bytes and CRC, not only declared archive sizes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-history-'));
  temps.push(dir);
  const bytes = zipSync({ HEAD: strToU8('ref: refs/heads/main\n') }, { level: 0 });
  const pack = path.join(dir, '.history-pack.zip');
  await writeFile(pack, bytes);
  await expect(validateHistoryPack(dir, pack)).resolves.toBeUndefined();
  // Keep both size headers intact: only damage the stored file's actual payload.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  bytes[start] ^= 1;
  await writeFile(pack, bytes);
  await expect(validateHistoryPack(dir, pack)).rejects.toThrow();
});
it('the shipped standalone runner also rejects corrupt history before writing files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-history-runner-'));
  temps.push(dir);
  const bytes = zipSync({ HEAD: strToU8('ref: refs/heads/main\n') }, { level: 0 });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  bytes[30 + view.getUint16(26, true) + view.getUint16(28, true)] ^= 1;
  const pack = path.join(dir, 'bad.zip');
  await writeFile(pack, bytes);
  const runner = path.resolve(
    import.meta.dirname,
    '../../../../resources/design/history-runner/runner.mjs'
  );
  await expect(
    runCommand(process.execPath, [runner, JSON.stringify({ cmd: 'unpack', dir, from: pack })], {
      cwd: dir,
      captureStdout: true,
      timeoutMs: 5000,
    })
  ).rejects.toMatchObject({ code: 'FAILED' });
  await expect(readFile(path.join(dir, '.history', 'HEAD'))).rejects.toThrow();
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
