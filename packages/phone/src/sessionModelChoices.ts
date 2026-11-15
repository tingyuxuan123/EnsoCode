import type { ProviderEntry, ThinkingLevel } from '@enso/pair';

/** 新建会话 / 会话设置共用的一行一个模型选项（provider × model 拍平） */
export interface ModelOption {
  key: string;
  providerId: string;
  providerName: string;
  modelId: string;
  label: string;
}

/** 现有思考档位全集：不能为了稿子上的「关」删合法档，「关」由推理开关表达 */
export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export const THINKING_LABELS: Record<ThinkingLevel, string> = {
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
};

export function thinkingLevelLabel(level: ThinkingLevel): string {
  return THINKING_LABELS[level];
}

export function modelOptionKey(providerId: string, modelId: string): string {
  return `${providerId}\n${modelId}`;
}

export function listModelOptions(providers: readonly ProviderEntry[]): ModelOption[] {
  return providers.flatMap((provider) =>
    provider.models.map((model) => ({
      key: modelOptionKey(provider.id, model.id),
      providerId: provider.id,
      providerName: provider.name,
      modelId: model.id,
      label: model.label ?? model.id,
    }))
  );
}

/** 手选 > 列表第一项；目录异步到达或手选项失效时回落，避免永远选不中 */
export function resolveModelOption(
  options: readonly ModelOption[],
  pickedProviderId: string | null,
  pickedModelId: string | null
): ModelOption | undefined {
  return (
    options.find((o) => o.providerId === pickedProviderId && o.modelId === pickedModelId) ??
    options[0]
  );
}

/** 白卡里的模型胶囊：当前模型 + 思考档位；没模型时明说要去选 */
export function modelPillLabel(
  modelLabel: string,
  reasoningEnabled: boolean,
  level: ThinkingLevel
): string {
  const label = modelLabel.trim();
  if (!label) return '选择模型';
  return reasoningEnabled ? `${label} · 思考 ${thinkingLevelLabel(level)}` : `${label} · 不思考`;
}
