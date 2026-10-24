import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const userData = mkdtempSync(path.join(tmpdir(), 'enso-settings-code-search-'));
const pushCodeSearchConfig = vi.fn(async () => {});

vi.mock('electron', () => ({
  app: { getPath: () => userData, on: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));

// settings 保存后动态 import agentHost 推配置；mock 掉避免把 worker 入口拖进测试。
vi.mock('../services/agentHost', () => ({
  pushApprovalReviewer: vi.fn(),
  pushCompactRoute: vi.fn(),
  pushMaxActiveCoworkers: vi.fn(),
  pushAutoRetryLimit: vi.fn(),
  pushDisabledWorkflowPresets: vi.fn(),
  pushModelDirectory: vi.fn(),
  pushWebSearchConfig: vi.fn(),
  pushCodeSearchConfig,
}));
vi.mock('../services/oauthProviders', () => ({
  readStoredOauthCredentialKeys: async () => new Set(['devin', 'devin#2']),
}));
vi.mock('../services/modelDirectory', () => ({
  notifyModelDirectorySettingsChanged: () => {},
}));

let settings: typeof import('./settings');

beforeAll(async () => {
  settings = await import('./settings');
});

afterAll(() => {
  settings.flushSettings();
  rmSync(userData, { recursive: true, force: true });
});

describe('codeSearchAccountKey 设置字段', () => {
  it('登记为设备本地字段，不参与 config-sync 指纹与回写', () => {
    expect(settings.SETTINGS_STATE_FIELDS).toContain('codeSearchAccountKey');
    expect(settings.CONFIG_SYNC_COMMIT_FIELDS).not.toContain('codeSearchAccountKey');
  });

  it('保存显式选号后归一化并触发代码搜索配置推送', async () => {
    pushCodeSearchConfig.mockClear();
    expect(settings.patchSettingsState('codeSearchAccountKey', ' devin#2 ')).toMatchObject({
      ok: true,
    });
    await vi.waitFor(() => expect(pushCodeSearchConfig).toHaveBeenCalled());
    expect(settings.readSettings()?.['enso-settings']).toMatchObject({
      state: { codeSearchAccountKey: 'devin#2' },
    });
  });

  it.each(['anthropic', 'devin#1', 'devin#01', '', 'devin-session-token$secret', 1, {}])(
    '拒绝非 devin 账号引用：%s',
    (value) => {
      expect(settings.patchSettingsState('codeSearchAccountKey', value)).toMatchObject({
        ok: false,
      });
    }
  );

  it('允许清空为 null（关闭代码搜索选号）', () => {
    expect(settings.patchSettingsState('codeSearchAccountKey', null)).toMatchObject({ ok: true });
    expect(settings.readSettings()?.['enso-settings']).toMatchObject({
      state: { codeSearchAccountKey: null },
    });
  });

  it('config-sync 备份恢复提交后同样重推代码搜索配置', async () => {
    pushCodeSearchConfig.mockClear();
    const current = settings.readSettings();
    const result = settings.commitSettingsTransaction(settings.settingsFingerprint(current), {
      providers: [],
    });
    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(pushCodeSearchConfig).toHaveBeenCalled());
  });
});
