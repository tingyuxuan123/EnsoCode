import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IPC_CHANNELS } from '@shared/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const directory = mkdtempSync(path.join(tmpdir(), 'enso-settings-secrets-'));
const h = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }));
vi.mock('electron', () => ({
  app: { getPath: () => directory, on: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      h.handlers.set(channel, handler),
  },
}));
vi.mock('../services/modelDirectory', () => ({ notifyModelDirectorySettingsChanged: vi.fn() }));
vi.mock('../services/memoryHost', () => ({}));
vi.mock('../services/speech/service', () => ({}));
vi.mock('../services/trayToggleShortcut', () => ({ syncTrayToggleShortcut: vi.fn() }));

import { settingsSecrets } from '../services/settingsSecrets';
import { flushSettings, readSettings, registerSettingsHandlers } from './settings';

const event = { sender: { id: 1 } };
const write = (value: unknown) =>
  h.handlers.get(IPC_CHANNELS.SETTINGS_WRITE_KEY)!(event, 'enso-settings', value);
const read = async () =>
  (await h.handlers.get(IPC_CHANNELS.SETTINGS_READ)!(event)) as {
    'enso-settings': {
      state: {
        theme: string;
        providers: Array<{ id: string; api: string; apiKey: string; baseUrl: string }>;
        mcpServers: Array<{ env: Record<string, string>; headers: Record<string, string> }>;
      };
    };
  };
const fixture = () => ({
  state: {
    theme: 'light',
    providers: [
      {
        id: 'p',
        name: 'P',
        api: 'anthropic-messages',
        apiKey: 'sk-private-fixture',
        baseUrl: 'https://provider.example',
        enabled: true,
        models: [{ id: 'model' }],
      },
    ],
    mcpServers: [
      {
        id: 'm',
        name: 'M',
        transport: 'stdio',
        command: 'server',
        env: { TOKEN: 'private-mcp-env' },
        headers: { Authorization: 'private-mcp-header' },
        enabled: true,
        source: 'manual',
      },
    ],
  },
});

beforeAll(() => registerSettingsHandlers());
afterAll(() => {
  flushSettings();
  rmSync(directory, { recursive: true, force: true });
});

describe('Main-only settings secrets', () => {
  it('Main 按原始凭证合并重复导入，保留已有 ID 与模型', async () => {
    await write(fixture());
    const current = (await read())['enso-settings'];
    const imported = settingsSecrets.provider(
      { ...fixture().state.providers[0], id: 'duplicate', models: [{ id: 'new-model' }] },
      true
    );
    current.state.providers.push(imported);
    expect(await write(current)).toBe(true);
    const state = (readSettings()!['enso-settings'] as ReturnType<typeof fixture>).state;
    expect(state.providers).toHaveLength(1);
    expect(state.providers[0]).toMatchObject({
      id: 'p',
      apiKey: 'sk-private-fixture',
      models: [{ id: 'model' }, { id: 'new-model' }],
    });
  });
  it('手动输入相同 key 的新条目也由 Main 去重，不能依赖 Renderer 的引用相等性', async () => {
    await write(fixture());
    const current = (await read())['enso-settings'];
    current.state.providers.push({ ...fixture().state.providers[0], id: 'manual-duplicate' });
    expect(await write(current)).toBe(true);
    expect((await read())['enso-settings'].state.providers).toHaveLength(1);
  });
  it('读 IPC 只有非空凭证引用，磁盘和 Main 保持原始凭证', async () => {
    expect(await write(fixture())).toBe(true);
    const projected = await read();
    expect(JSON.stringify(projected)).not.toContain('sk-private-fixture');
    expect(JSON.stringify(projected)).not.toContain('private-mcp-env');
    expect(JSON.stringify(projected)).not.toContain('private-mcp-header');
    expect(projected['enso-settings'].state.providers[0].apiKey).toBeTruthy();
    expect(readSettings()?.['enso-settings']).toEqual(fixture());
    flushSettings();
    expect(readFileSync(path.join(directory, 'settings.json'), 'utf8')).toContain(
      'sk-private-fixture'
    );
  });
  it('改主题或模型清单回写脱敏引用不覆盖原凭证', async () => {
    await write(fixture());
    const projected = await read();
    projected['enso-settings'].state.theme = 'dark';
    expect(await write(projected['enso-settings'])).toBe(true);
    expect(readSettings()?.['enso-settings']).toEqual({
      ...fixture(),
      state: { ...fixture().state, theme: 'dark' },
    });
  });
  it('脱敏 key 不可带到不同端点，失败不改变原配置', async () => {
    await write(fixture());
    const projected = await read();
    projected['enso-settings'].state.providers[0].baseUrl = 'https://untrusted.example';
    expect(await write(projected['enso-settings'])).toBe(false);
    expect(readSettings()?.['enso-settings']).toEqual(fixture());
  });
  it('显式替换和清空凭证生效，删除条目不因秘密合并而复活', async () => {
    await write(fixture());
    const projected = await read();
    projected['enso-settings'].state.providers[0].apiKey = '';
    projected['enso-settings'].state.mcpServers[0].env = {};
    expect(await write(projected['enso-settings'])).toBe(true);
    expect((await read())['enso-settings'].state.providers[0].apiKey).toBe('');
    projected['enso-settings'].state.providers = [];
    expect(await write(projected['enso-settings'])).toBe(true);
    expect((await read())['enso-settings'].state.providers).toEqual([]);
  });
});
