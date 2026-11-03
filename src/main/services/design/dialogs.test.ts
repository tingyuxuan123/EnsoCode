import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';

const { open, save } = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('electron', () => ({ dialog: { showOpenDialog: open, showSaveDialog: save } }));

import { designOpenFiles, designSaveAs } from './fs';

const temps: string[] = [];
const owner = {} as BrowserWindow;
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-dialog-'));
  temps.push(dir);
  return dir;
}
it('reads only user-picked design files; cancellation returns no files and enforces byte limits', async () => {
  const dir = await fixture();
  const file = path.join(dir, 'test.vetdz');
  await writeFile(file, 'share');
  open.mockResolvedValueOnce({ canceled: true, filePaths: [] });
  expect(await designOpenFiles(owner, {})).toEqual({ ok: true, files: [] });
  open.mockResolvedValueOnce({ canceled: false, filePaths: [file] });
  expect(await designOpenFiles(owner, {})).toMatchObject({
    ok: true,
    files: [{ name: 'test.vetdz', data: Buffer.from('share').toString('base64') }],
  });
  open.mockResolvedValueOnce({ canceled: false, filePaths: [file] });
  await expect(designOpenFiles(owner, { maxBytes: 2 })).rejects.toMatchObject({
    code: 'TOO_LARGE',
  });
  const bad = path.join(dir, 'secret.txt');
  open.mockResolvedValueOnce({ canceled: false, filePaths: [bad] });
  await expect(designOpenFiles(owner, {})).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  await truncate(file, 32 * 1024 * 1024 + 1);
  open.mockResolvedValueOnce({ canceled: false, filePaths: [file] });
  await expect(designOpenFiles(owner, {})).rejects.toMatchObject({ code: 'TOO_LARGE' });
});
it('save-as writes exact bytes only to the dialog-selected path and leaves nothing on cancellation', async () => {
  const dir = await fixture();
  const file = path.join(dir, 'out.pdf');
  const request = {
    defaultFileName: 'out.pdf',
    content: Buffer.from('%PDF-1.4\n').toString('base64'),
    encoding: 'base64' as const,
  };
  save.mockResolvedValueOnce({ canceled: true });
  expect(await designSaveAs(owner, request)).toEqual({ ok: true, path: null });
  await expect(readFile(file)).rejects.toThrow();
  save.mockResolvedValueOnce({ canceled: false, filePath: file });
  expect(await designSaveAs(owner, request)).toEqual({ ok: true, path: file });
  expect(await readFile(file, 'utf8')).toBe('%PDF-1.4\n');
});
