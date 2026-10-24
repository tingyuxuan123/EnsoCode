import { providerKeyFor } from '@shared/providers/providerKey';
import type { SmartCompactMode } from '@shared/smartCompactMode';
import type { SpawnModelConfig } from '@shared/types/agent';
import { createCodexCompactFactory } from './codexCompact';
import {
  createEnsoCompactFactory,
  ensoCompactInlineExtension as defaultEnsoCompactInlineExtension,
} from './ensoCompact/extension';
import type { EnsoCompactOptions } from './ensoCompact/types';

export { providerKeyFor } from '@shared/providers/providerKey';

export function formatSmartCompactSummaryModel(model: SpawnModelConfig): string {
  const provider = model.oauthAccountKey ?? providerKeyFor(model);
  return `${provider}/${model.modelId}`;
}

export function parseSmartCompactSummaryRef(
  formatted: string | undefined
): { provider: string; id: string } | undefined {
  if (!formatted) return undefined;
  const slash = formatted.indexOf('/');
  if (slash <= 0 || slash === formatted.length - 1) return undefined;
  return { provider: formatted.slice(0, slash), id: formatted.slice(slash + 1) };
}

export function smartCompactInlineExtension(
  route?: {
    summaryModel?: SpawnModelConfig | null;
    mode?: 'auto' | 'fast' | 'balanced' | 'thorough';
  } | null,
  codexNative = false,
  /** 已打开会话与后来的设置共用这一份；压缩时读，不在装载时拷走 */
  shared?: EnsoCompactOptions
) {
  if (!route && !codexNative && !shared) return defaultEnsoCompactInlineExtension;
  const options = shared ?? {
    mode: route?.mode,
    summaryModel: route?.summaryModel
      ? parseSmartCompactSummaryRef(formatSmartCompactSummaryModel(route.summaryModel))
      : undefined,
  };
  return {
    name: codexNative ? 'enso-codex-compact' : 'enso-compact',
    hidden: true as const,
    factory: codexNative ? createCodexCompactFactory(options) : createEnsoCompactFactory(options),
  };
}

/** 覆盖当前摘要路线。model 缺省表示下一次压缩改跟会话模型。 */
export function assignCompactRoute(
  route: EnsoCompactOptions,
  model: SpawnModelConfig | undefined,
  mode: SmartCompactMode | undefined
): void {
  route.mode = mode;
  route.summaryModel = model
    ? parseSmartCompactSummaryRef(formatSmartCompactSummaryModel(model))
    : undefined;
}
