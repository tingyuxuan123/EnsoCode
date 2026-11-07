import { mergeFetchedModels } from '@shared/modelEntry';
import type {
  FetchedModel,
  ListModelsResult,
  ModelEntry,
  ModelMetaQuery,
  ModelMetaResult,
  ModelProvider,
  ProviderApiConfig,
} from '@shared/types';

export type ProviderFetchStatus =
  | { state: 'queued' | 'fetching' | 'skipped' }
  | { state: 'success'; count: number }
  | { state: 'error'; message: string };

export interface ProviderFetchSummary {
  success: number;
  failed: number;
  skipped: number;
}

interface ProviderModelFetcherOptions {
  api: {
    listModels(config: ProviderApiConfig): Promise<ListModelsResult>;
    modelMeta(query: ModelMetaQuery): Promise<ModelMetaResult>;
  };
  getProviders(): readonly ModelProvider[];
  updateModels(id: string, models: ModelEntry[]): void;
  onStatus(id: string, status: ProviderFetchStatus): void;
}

/** 只比较请求身份；名称、启用状态和 models 的编辑不使请求失效。凭证引用不解密。 */
function requestIdentity(provider: ModelProvider): string {
  return JSON.stringify([
    provider.api,
    provider.baseUrl,
    provider.apiKey,
    provider.oauthAccountKey,
    provider.oauthAccountPool?.accountKeys,
  ]);
}

/** 单页批次，最多三个在途请求；重复触发复用当前批次，不创建第二组请求。 */
export function createProviderModelFetcher(options: ProviderModelFetcherOptions) {
  let active: Promise<ProviderFetchSummary> | undefined;

  async function run(): Promise<ProviderFetchSummary> {
    const targets = options.getProviders().map((provider) => ({
      provider: { ...provider },
      identity: requestIdentity(provider),
    }));
    const summary: ProviderFetchSummary = { success: 0, failed: 0, skipped: 0 };
    let next = 0;

    async function refreshOne(target: (typeof targets)[number]): Promise<ProviderFetchStatus> {
      const { provider, identity } = target;
      const currentProvider = () => {
        const current = options.getProviders().find((entry) => entry.id === provider.id);
        return current && requestIdentity(current) === identity ? current : undefined;
      };
      // 排队期间被删除或换了连接，不再向旧身份发请求。
      if (!currentProvider()) return { state: 'skipped' };
      options.onStatus(provider.id, { state: 'fetching' });
      try {
        let fetched: FetchedModel[] | undefined;
        let count: number;
        if (provider.oauthAccountKey) {
          const result = await options.api.modelMeta({
            oauthAccountKey: provider.oauthAccountKey,
            modelIds: [],
          });
          if (!result.ok) throw new Error(result.error ?? 'Failed');
          // Main 已刷新并广播权威目录；不把 catalog 事实固化成 settings 的用户覆盖。
          count = result.models.filter((model) => model.source !== 'unknown').length;
        } else {
          const result = await options.api.listModels({
            api: provider.api,
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
          });
          if (!result.ok) throw new Error(result.error ?? 'Failed');
          fetched = result.models;
          count = fetched.length;
        }
        // 请求返回后重读最新 store；删除不复活，换端点/凭证不写入，模型编辑参与合并。
        const current = currentProvider();
        if (!current) return { state: 'skipped' };
        if (fetched) options.updateModels(provider.id, mergeFetchedModels(current.models, fetched));
        return { state: 'success', count };
      } catch (error) {
        if (!currentProvider()) return { state: 'skipped' };
        return { state: 'error', message: error instanceof Error ? error.message : String(error) };
      }
    }

    async function worker() {
      while (next < targets.length) {
        const target = targets[next++];
        const status = await refreshOne(target);
        options.onStatus(target.provider.id, status);
        if (status.state === 'success') summary.success++;
        else if (status.state === 'error') summary.failed++;
        else summary.skipped++;
      }
    }

    for (const target of targets) options.onStatus(target.provider.id, { state: 'queued' });
    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, () => worker()));
    return summary;
  }

  return {
    refresh(): Promise<ProviderFetchSummary> {
      if (!active) {
        active = run().finally(() => {
          active = undefined;
        });
      }
      return active;
    },
  };
}
