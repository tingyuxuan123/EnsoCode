import type { ListModelsResult, ModelEntry, ModelProvider } from '@shared/types';
import { describe, expect, it, vi } from 'vitest';
import { createProviderModelFetcher, type ProviderFetchStatus } from './providerFetch';

function provider(id: string, patch: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id,
    name: id,
    api: 'openai-completions',
    apiKey: `enso-secret:${id}`,
    baseUrl: `https://${id}.example/v1`,
    enabled: true,
    models: [{ id: 'existing', enabled: false, contextWindow: 4096 }],
    ...patch,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup(initial: ModelProvider[]) {
  let providers = initial;
  const api = {
    listModels: vi.fn(
      async (_config: { apiKey: string }): Promise<ListModelsResult> => ({
        ok: true,
        models: [{ id: 'existing', contextWindow: 8192 }, { id: 'new' }],
      })
    ),
    modelMeta: vi.fn(async (_query: { oauthAccountKey?: string; modelIds: string[] }) => ({
      ok: true,
      models: [
        { modelId: 'catalog-model', contextWindow: 128000, source: 'catalog' as const },
        { modelId: 'missing', source: 'unknown' as const },
      ],
    })),
  };
  const statuses: Record<string, ProviderFetchStatus> = {};
  const updateModels = vi.fn((id: string, models: ModelEntry[]) => {
    providers = providers.map((item) => (item.id === id ? { ...item, models } : item));
  });
  const fetcher = createProviderModelFetcher({
    api,
    getProviders: () => providers,
    updateModels,
    onStatus: (id, status) => {
      statuses[id] = status;
    },
  });
  return {
    api,
    statuses,
    updateModels,
    fetcher,
    read: () => providers,
    write: (next: ModelProvider[]) => {
      providers = next;
    },
  };
}

describe('模型中心批量刷新', () => {
  it('API 条目原样传凭证引用，并保留已有模型的用户设置', async () => {
    const h = setup([provider('api', { enabled: false })]);
    expect(await h.fetcher.refresh()).toEqual({ success: 1, failed: 0, skipped: 0 });
    expect(h.api.listModels).toHaveBeenCalledWith({
      api: 'openai-completions',
      apiKey: 'enso-secret:api',
      baseUrl: 'https://api.example/v1',
    });
    expect(h.read()[0].models).toEqual([
      { id: 'existing', enabled: false, contextWindow: 4096 },
      { id: 'new', enabled: true },
    ]);
    expect(h.statuses.api).toEqual({ state: 'success', count: 2 });
  });

  it('订阅只刷新 Main 目录，绝不把 catalog 元数据写成用户覆盖', async () => {
    const original = provider('oauth', { apiKey: '', baseUrl: '', oauthAccountKey: 'anthropic' });
    const h = setup([original]);
    expect(await h.fetcher.refresh()).toEqual({ success: 1, failed: 0, skipped: 0 });
    expect(h.api.modelMeta).toHaveBeenCalledWith({ oauthAccountKey: 'anthropic', modelIds: [] });
    expect(h.api.listModels).not.toHaveBeenCalled();
    expect(h.updateModels).not.toHaveBeenCalled();
    expect(h.read()).toEqual([original]);
    expect(h.statuses.oauth).toEqual({ state: 'success', count: 1 });
  });

  it('单项返回失败和抛出异常均隔离，其余条目继续完成', async () => {
    const h = setup([provider('bad'), provider('throws'), provider('good')]);
    h.api.listModels.mockImplementation(async ({ apiKey }) => {
      if (apiKey === 'enso-secret:bad') return { ok: false, models: [], error: 'Denied' };
      if (apiKey === 'enso-secret:throws') throw new Error('Offline');
      return { ok: true, models: [{ id: 'available' }] };
    });
    expect(await h.fetcher.refresh()).toEqual({ success: 1, failed: 2, skipped: 0 });
    expect(h.read()[0].models).toEqual([expect.objectContaining({ id: 'existing' })]);
    expect(h.read()[2].models).toEqual([{ id: 'available', enabled: true }]);
    expect(h.statuses.bad).toEqual({ state: 'error', message: 'Denied' });
    expect(h.statuses.throws).toEqual({ state: 'error', message: 'Offline' });
  });

  it('刷新在途时编辑的 models 使用最新 store 合并，不回写旧快照', async () => {
    const h = setup([provider('api')]);
    const pending = deferred<ListModelsResult>();
    h.api.listModels.mockReturnValue(pending.promise);
    const run = h.fetcher.refresh();
    h.write([
      provider('api', {
        models: [{ id: 'existing', enabled: true, label: 'Edited', maxTokens: 7 }],
      }),
    ]);
    pending.resolve({ ok: true, models: [{ id: 'existing', maxTokens: 99 }, { id: 'new' }] });
    await run;
    expect(h.read()[0].models).toEqual([
      { id: 'existing', enabled: true, label: 'Edited', maxTokens: 7 },
      { id: 'new', enabled: true },
    ]);
  });

  it('成功返回空清单按已有合并语义清空 API 模型', async () => {
    const h = setup([provider('api')]);
    h.api.listModels.mockResolvedValue({ ok: true, models: [] });
    await h.fetcher.refresh();
    expect(h.read()[0].models).toEqual([]);
    expect(h.statuses.api).toEqual({ state: 'success', count: 0 });
  });

  it('在途条目被删除后丢弃结果，不调用更新也不复活条目', async () => {
    const h = setup([provider('api')]);
    const pending = deferred<ListModelsResult>();
    h.api.listModels.mockReturnValue(pending.promise);
    const run = h.fetcher.refresh();
    h.write([]);
    pending.resolve({ ok: true, models: [{ id: 'new' }] });
    expect(await run).toEqual({ success: 0, failed: 0, skipped: 1 });
    expect(h.read()).toEqual([]);
    expect(h.updateModels).not.toHaveBeenCalled();
    expect(h.statuses.api).toEqual({ state: 'skipped' });
  });

  it.each([
    { api: 'anthropic-messages' as const },
    { baseUrl: 'https://changed.example' },
    { apiKey: 'enso-secret:changed' },
    { oauthAccountKey: 'anthropic' },
  ])('API 条目身份变化后旧结果不写入：%j', async (patch) => {
    const h = setup([provider('api')]);
    const pending = deferred<ListModelsResult>();
    h.api.listModels.mockReturnValue(pending.promise);
    const run = h.fetcher.refresh();
    h.write([provider('api', patch)]);
    pending.resolve({ ok: true, models: [{ id: 'wrong-endpoint' }] });
    expect(await run).toEqual({ success: 0, failed: 0, skipped: 1 });
    expect(h.updateModels).not.toHaveBeenCalled();
    expect(h.read()[0].models).not.toContainEqual(
      expect.objectContaining({ id: 'wrong-endpoint' })
    );
  });

  it('订阅账号或账号池身份变化后不报告旧目录为刷新成功', async () => {
    const original = provider('pool', {
      oauthAccountKey: 'openai-codex',
      oauthAccountPool: { accountKeys: ['openai-codex', 'openai-codex#2'] },
    });
    const h = setup([original]);
    const pending = deferred<Awaited<ReturnType<typeof h.api.modelMeta>>>();
    h.api.modelMeta.mockReturnValue(pending.promise);
    const run = h.fetcher.refresh();
    h.write([{ ...original, oauthAccountPool: { accountKeys: ['openai-codex#2'] } }]);
    pending.resolve({ ok: true, models: [] });
    expect(await run).toEqual({ success: 0, failed: 0, skipped: 1 });
    expect(h.statuses.pool).toEqual({ state: 'skipped' });
  });

  it('重复触发共用同一批请求，完成后可再次刷新', async () => {
    const h = setup([provider('api')]);
    const pending = deferred<ListModelsResult>();
    h.api.listModels.mockReturnValue(pending.promise);
    const first = h.fetcher.refresh();
    const second = h.fetcher.refresh();
    expect(second).toBe(first);
    expect(h.api.listModels).toHaveBeenCalledTimes(1);
    pending.resolve({ ok: true, models: [] });
    await Promise.all([first, second]);
    await h.fetcher.refresh();
    expect(h.api.listModels).toHaveBeenCalledTimes(2);
  });

  it('最多同时刷新三个条目，排队时被删除的条目不再发请求', async () => {
    const h = setup(['one', 'two', 'three', 'removed', 'five'].map((id) => provider(id)));
    const pending = deferred<ListModelsResult>();
    let active = 0;
    let maxActive = 0;
    h.api.listModels.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      const result = await pending.promise;
      active--;
      return result;
    });
    const run = h.fetcher.refresh();
    expect(h.api.listModels).toHaveBeenCalledTimes(3);
    expect(h.statuses.removed).toEqual({ state: 'queued' });
    h.write(h.read().filter((item) => item.id !== 'removed'));
    pending.resolve({ ok: true, models: [] });
    expect(await run).toEqual({ success: 4, failed: 0, skipped: 1 });
    expect(h.api.listModels).toHaveBeenCalledTimes(4);
    expect(maxActive).toBe(3);
  });

  it('没有条目时不产生 IPC 请求', async () => {
    const h = setup([]);
    expect(await h.fetcher.refresh()).toEqual({ success: 0, failed: 0, skipped: 0 });
    expect(h.api.listModels).not.toHaveBeenCalled();
    expect(h.api.modelMeta).not.toHaveBeenCalled();
  });
});
