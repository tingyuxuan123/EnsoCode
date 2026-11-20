import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultBindingStore } from './bindings';

const dirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-vault-bindings-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('VaultBindingStore', () => {
  it('resolves managed default paths per space kind and rejects invalid space IDs', () => {
    const root = tmpDir();
    const store = new VaultBindingStore(root);

    expect(store.resolveSpace('global')).toEqual({
      spaceId: 'global',
      rootPath: path.join(root, 'vaults', 'global'),
      isExternal: false,
      preset: 'personal',
    });
    expect(store.resolveSpace('proj:p1')).toEqual({
      spaceId: 'proj:p1',
      rootPath: path.join(root, 'vaults', 'projects', 'p1'),
      isExternal: false,
      preset: 'engineering',
    });

    const botId = '22222222-2222-4222-8222-222222222222';
    const chatId = '33333333-3333-4333-8333-333333333333';
    expect(store.resolveSpace(`bot:${botId}`).rootPath).toBe(
      path.join(root, 'vaults', 'bots', botId)
    );
    expect(store.resolveSpace(`chat:${chatId}`).rootPath).toBe(
      path.join(root, 'vaults', 'chats', chatId)
    );

    expect(() => store.resolveSpace('proj:../escape')).toThrow();
    expect(() => store.resolveSpace('unknown:123')).toThrow();
  });

  it('binds an external Obsidian vault, persists across reload, and unbinds without deleting files', () => {
    const root = tmpDir();
    const obsidianVault = tmpDir();
    const noteFile = path.join(obsidianVault, 'my-note.md');
    fs.writeFileSync(noteFile, '# Keep me\n');

    const store = new VaultBindingStore(root);
    store.bindExternal('proj:alpha', obsidianVault, 'minimal');

    const reloaded = new VaultBindingStore(root);
    const resolved = reloaded.resolveSpace('proj:alpha');
    expect(resolved.isExternal).toBe(true);
    expect(resolved.rootPath).toBe(fs.realpathSync(obsidianVault));
    expect(resolved.preset).toBe('minimal');

    reloaded.unbind('proj:alpha');
    expect(reloaded.resolveSpace('proj:alpha').isExternal).toBe(false);
    expect(fs.existsSync(noteFile)).toBe(true);
  });

  it('updates preset on a managed space without turning it external', () => {
    const root = tmpDir();
    const store = new VaultBindingStore(root);
    store.setPreset('global', 'engineering');
    const reloaded = new VaultBindingStore(root);
    expect(reloaded.resolveSpace('global').isExternal).toBe(false);
    expect(reloaded.resolveSpace('global').preset).toBe('engineering');
  });
});
