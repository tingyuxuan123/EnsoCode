import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IPC_CHANNELS } from '@shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: { sender: { id: number } }, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const showOpenDialog = vi.fn();
const openPath = vi.fn();
const openExternal = vi.fn();

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: (...args: unknown[]) => showOpenDialog(...args) },
  shell: {
    openPath: (...args: unknown[]) => openPath(...args),
    openExternal: (...args: unknown[]) => openExternal(...args),
  },
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
  },
}));

vi.mock('../windows/MainWindow', () => ({ isMainWebContents: (id: number) => id === 1 }));
vi.mock('../windows/SettingsWindow', () => ({ isSettingsWebContents: (id: number) => id === 2 }));
vi.mock('../windows/createAppWindow', () => ({ sendToAllWindows: vi.fn() }));
vi.mock('./settings', () => ({ readSettings: () => ({}) }));
vi.mock('./agent', () => ({ getSourceAuthorityRegistry: () => null }));

import { closeMemoryDb, setMemoryRootForTest } from '../services/memoryHost';
import { registerMemoryHandlers } from './memory';

const dirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-memory-ipc-'));
  dirs.push(dir);
  return dir;
}

const trusted = { sender: { id: 1 } };
const untrusted = { sender: { id: 999 } };

beforeEach(() => {
  handlers.clear();
  showOpenDialog.mockReset();
  openPath.mockReset();
  openExternal.mockReset();
  setMemoryRootForTest(tmpDir());
  registerMemoryHandlers();
});

afterEach(() => {
  closeMemoryDb();
  setMemoryRootForTest(null);
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('memory IPC handlers', () => {
  it('rejects untrusted senders and malformed payloads', async () => {
    const list = handlers.get(IPC_CHANNELS.MEMORY_LIST)!;
    expect(await list(untrusted, { limit: 10, offset: 0 })).toEqual({
      items: [],
      total: 0,
      types: [],
    });
    expect(await list(trusted, { limit: -1, offset: 0 })).toEqual({
      items: [],
      total: 0,
      types: [],
    });

    const create = handlers.get(IPC_CHANNELS.MEMORY_CREATE)!;
    expect(
      await create(trusted, { spaceId: '../escape', title: 'X', type: 'notes', body: 'hi' })
    ).toEqual({
      ok: false,
      error: 'Invalid request.',
    });
  });

  it('creates, edits, verifies, graphs, lints, and binds external Obsidian vault via Main dialog', async () => {
    const create = handlers.get(IPC_CHANNELS.MEMORY_CREATE)!;
    const list = handlers.get(IPC_CHANNELS.MEMORY_LIST)!;
    const graph = handlers.get(IPC_CHANNELS.MEMORY_GRAPH)!;
    const lint = handlers.get(IPC_CHANNELS.MEMORY_LINT)!;
    const bind = handlers.get(IPC_CHANNELS.MEMORY_BIND_VAULT)!;

    const created = (await create(trusted, {
      spaceId: 'global',
      title: '测试页',
      type: 'notes',
      description: '简介',
      body: '正文 [[missing-target]]',
    })) as { ok: boolean; note?: { id: string } };
    expect(created.ok).toBe(true);

    const listed = (await list(trusted, { spaceId: 'global', limit: 20, offset: 0 })) as {
      total: number;
    };
    expect(listed.total).toBe(1);

    const g = (await graph(trusted, { spaceId: 'global', limit: 50 })) as { nodes: unknown[] };
    expect(g.nodes).toHaveLength(1);

    const report = (await lint(trusted, 'global')) as { issues: { kind: string }[] };
    expect(report.issues.some((i) => i.kind === 'broken_link')).toBe(true);

    const externalVault = tmpDir();
    fs.writeFileSync(path.join(externalVault, 'obsidian-note.md'), '# From Obsidian\n\nHello!\n');
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [externalVault] });

    const bound = (await bind(trusted, 'global')) as {
      ok: boolean;
      space?: { isExternal: boolean };
    };
    expect(bound.ok).toBe(true);
    expect(bound.space?.isExternal).toBe(true);

    const afterBind = (await list(trusted, { spaceId: 'global', limit: 20, offset: 0 })) as {
      items: { title: string }[];
    };
    expect(afterBind.items.map((i) => i.title)).toContain('From Obsidian');

    const readVaultDocHandler = handlers.get(IPC_CHANNELS.MEMORY_READ_VAULT_DOC)!;
    expect(readVaultDocHandler).toBeTypeOf('function');
    expect(await readVaultDocHandler(untrusted, 'global', 'schema')).toBeNull();
    expect(await readVaultDocHandler(trusted, '../bad', 'schema')).toBeNull();
    expect(await readVaultDocHandler(trusted, 'global', 'secret')).toBeNull();
    const schemaDoc = (await readVaultDocHandler(trusted, 'global', 'schema')) as {
      filename: string;
      content: string;
    } | null;
    expect(schemaDoc?.filename).toBe('schema.md');
    expect(schemaDoc?.content.length).toBeGreaterThan(0);
  });
});
