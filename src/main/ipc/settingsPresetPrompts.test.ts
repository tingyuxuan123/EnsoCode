import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const userData = mkdtempSync(join(tmpdir(), 'enso-preset-persistence-'));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});
vi.mock('electron', () => ({
  app: { getPath: () => userData, on: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../services/llama/chat', () => ({ syncLocalChatFromSettings: vi.fn() }));
vi.mock('../services/agentHost', () => ({
  pushApprovalReviewer: vi.fn(),
  pushMaxActiveCoworkers: vi.fn(),
}));
vi.mock('../services/oauthProviders', () => ({
  readStoredOauthCredentialKeys: async () => new Set(),
}));

const { flushSettings, patchSettingsState } = await import('./settings');
const { writeSystemPrompt } = await import('../services/systemPromptStore');
const promptId = 'e1ad4243-e185-4c15-a90f-598f0974b2a1';
const file = join(userData, 'system-prompts', `${promptId}.md`);
const preset = (id: string) => ({
  id,
  name: id,
  skillIds: [],
  mcpServerIds: [],
  systemPromptId: promptId,
});

beforeEach(() => {
  vi.mocked(renameSync).mockClear();
  expect(writeSystemPrompt(promptId, 'original prompt').ok).toBe(true);
  patchSettingsState('presets', [preset('first')]);
  expect(flushSettings()).toBe(true);
});
afterAll(() => {
  flushSettings();
  rmSync(userData, { recursive: true, force: true });
});

describe('预设正文清理必须晚于设置持久化', () => {
  it('删除引用先保留正文，原子落盘成功后才清理', () => {
    patchSettingsState('presets', []);
    expect(existsSync(file)).toBe(true);
    expect(flushSettings()).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  it('落盘失败保留旧正文和旧磁盘引用，重试成功才清理', () => {
    patchSettingsState('presets', []);
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw new Error('disk failure');
    });
    expect(flushSettings()).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe('original prompt');
    const disk = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'));
    expect(disk['enso-settings'].state.presets[0].systemPromptId).toBe(promptId);
    expect(flushSettings()).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  it('其它预设仍引用正文时不删除', () => {
    patchSettingsState('presets', [preset('first'), preset('second')]);
    flushSettings();
    patchSettingsState('presets', [preset('second')]);
    flushSettings();
    expect(readFileSync(file, 'utf8')).toBe('original prompt');
  });

  it('防抖期间取消删除并重新引用，不清理仍在使用的正文', () => {
    patchSettingsState('presets', []);
    patchSettingsState('presets', [preset('first')]);
    flushSettings();
    expect(readFileSync(file, 'utf8')).toBe('original prompt');
  });
});
