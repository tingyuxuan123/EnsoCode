import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WebContents } from 'electron';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const userData = mkdtempSync(path.join(tmpdir(), 'enso-oauth-code-search-'));
const authFile = path.join(userData, 'agent', 'pi-agent', 'auth.json');
const pushCodeSearchConfig = vi.fn(async () => {});

vi.mock('electron', () => ({
  app: { getPath: () => userData, getName: () => 'enso-code', on: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: async () => {} },
}));
vi.mock('./agentHost', () => ({ pushCodeSearchConfig }));
vi.mock('./proxyConfig', () => ({ getProxyConfig: () => ({ whenReady: async () => true }) }));
vi.mock('./modelDirectory', () => ({ refreshModelDirectory: async () => {} }));

const oauthKeys = new Set(['devin', 'anthropic']);
const provider = {
  id: 'devin',
  name: 'Devin',
  auth: { oauth: { name: 'Devin' } },
  getModels: () => [{ id: 'devin-model' }],
};
const runtime = {
  registerProvider: () => {},
  registerNativeProvider: () => {},
  unregisterProvider: () => {},
  getProvider: (id: string) => (id === 'devin' ? provider : undefined),
  getProviders: () => [provider],
  listCredentials: async () => [...oauthKeys].map((providerId) => ({ providerId, type: 'oauth' })),
  refresh: async () => ({ aborted: false, errors: new Map() }),
  getAuth: async () => ({ auth: { apiKey: 'opaque-token' } }),
  login: async (accountKey: string) => {
    oauthKeys.add(accountKey);
  },
  logout: async (accountKey: string) => {
    oauthKeys.delete(accountKey);
  },
};

beforeAll(() => {
  mkdirSync(path.dirname(authFile), { recursive: true });
  writeFileSync(
    authFile,
    JSON.stringify({
      devin: {
        type: 'oauth',
        access: 'devin-token',
        refresh: 'r1',
        expires: Date.now() + 3_600_000,
      },
      anthropic: {
        type: 'oauth',
        access: 'anthropic-token',
        refresh: 'r2',
        expires: Date.now() + 3_600_000,
      },
    })
  );
  vi.doMock('@earendil-works/pi-coding-agent', () => ({
    ModelRuntime: { create: async () => runtime },
  }));
});

afterAll(() => {
  vi.doUnmock('@earendil-works/pi-coding-agent');
  rmSync(userData, { recursive: true, force: true });
});

describe('OAuth 账号变化触发代码搜索配置失效', () => {
  beforeEach(() => {
    oauthKeys.clear();
    for (const key of ['devin', 'anthropic']) oauthKeys.add(key);
    pushCodeSearchConfig.mockClear();
  });

  it('登出已存账号后按同 key 强制换代码搜索代际', async () => {
    const { oauthLogout } = await import('./oauthProviders');
    await oauthLogout('devin');
    await vi.waitFor(() =>
      expect(pushCodeSearchConfig).toHaveBeenCalledWith({ invalidateAccountKey: 'devin' })
    );
  });

  it('登出已缺失账号也触发失效（不能留着旧配置继续搜索）', async () => {
    const { oauthLogout } = await import('./oauthProviders');
    await oauthLogout('devin#9');
    await vi.waitFor(() =>
      expect(pushCodeSearchConfig).toHaveBeenCalledWith({ invalidateAccountKey: 'devin#9' })
    );
  });

  it('OAuth 登录成功即使同 key 也强制换代际，丢弃在途搜索与 JWT 缓存', async () => {
    const { beginOauthLogin } = await import('./oauthProviders');
    const sender = {
      id: 7,
      isDestroyed: () => false,
      send: () => {},
    } as unknown as WebContents;
    const handle = beginOauthLogin('devin', sender, {
      flowId: crypto.randomUUID(),
      ownerWebContentsId: 7,
      host: 'provider-wizard',
    });
    if (handle.completion) await handle.completion;
    await vi.waitFor(() =>
      expect(pushCodeSearchConfig).toHaveBeenCalledWith({ invalidateAccountKey: 'devin#2' })
    );
  });
});
