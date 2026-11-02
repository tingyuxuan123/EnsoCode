import { pickModelCapabilityOverrides } from '@shared/modelCatalog';
import type { ModelEntry } from '@shared/types/llm';
import { isVirtualRef, parseVirtualModels } from '@shared/virtualModels';

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Main-only consent identity. Never log/serialize this value: it contains credentials.
 * Mirrors agentHost.spawnModelConfig, plus availability and all virtual direct candidates.
 * Both fast and primary are bound because credential/catalog availability can select either.
 */
export function approvalReviewerConsentConfiguration(state: Record<string, unknown>): unknown {
  const reviewer = record(state.approvalReviewer);
  if (!reviewer) return state.approvalReviewer;
  const providers = Array.isArray(state.providers) ? state.providers.map(record) : [];
  const physical = (ref: { providerId: unknown; modelId: unknown }) => {
    const provider = providers.find((item) => item?.id === ref.providerId);
    const model = (Array.isArray(provider?.models) ? provider.models : [])
      .map(record)
      .find((item) => item?.id === ref.modelId);
    const pool = record(provider?.oauthAccountPool);
    return {
      ref,
      enabled: provider?.enabled,
      modelEnabled: model?.enabled,
      api: provider?.api,
      // This is operational: catalogId=typesafe switches chat to classifier resolution.
      catalogId: provider?.catalogId,
      baseUrl: provider?.baseUrl,
      apiKey: provider?.apiKey,
      oauthAccountKey: provider?.oauthAccountKey,
      oauthAccountPool: provider?.oauthAccountPool,
      capabilities: pickModelCapabilityOverrides(model as ModelEntry | undefined),
      // Pool members are authentication sources too, not just their string identities.
      poolMembers: (Array.isArray(pool?.accountKeys) ? pool.accountKeys : []).map((key) =>
        providers
          .filter((item) => item?.oauthAccountKey === key)
          .map((item) => ({
            id: item?.id,
            enabled: item?.enabled,
            oauthAccountKey: item?.oauthAccountKey,
            model: (Array.isArray(item?.models) ? item.models : []).find(
              (entry) => record(entry)?.id === ref.modelId
            ),
          }))
      ),
    };
  };
  if (
    !isVirtualRef({
      providerId: typeof reviewer.providerId === 'string' ? reviewer.providerId : undefined,
    })
  )
    return physical({ providerId: reviewer.providerId, modelId: reviewer.modelId });
  const entry = parseVirtualModels(state.virtualModels).find(
    (item) => item.id === reviewer.modelId
  );
  return {
    reviewer,
    enabled: entry?.enabled,
    primary: entry ? physical(entry.primary) : undefined,
    fast: entry?.fast ? physical(entry.fast) : undefined,
  };
}
