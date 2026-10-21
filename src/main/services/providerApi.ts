import { classify } from '@earendil-works/pi-ai/api/typesafe-system-one';
import { typesafeProvider } from '@earendil-works/pi-ai/providers/typesafe';
import { positiveFiniteNumber } from '@shared/modelCatalog';
import {
  DEFAULT_BASE_URLS,
  isClassifierOnlyProvider,
  withVersionSegment,
} from '@shared/providerCatalog';
import type {
  FetchedModel,
  ListModelsResult,
  ModelApiKind,
  ModelThinkingLevelOverride,
  ProviderApiConfig,
  TestProviderResult,
} from '@shared/types';
import { MODEL_THINKING_LEVEL_OVERRIDES } from '@shared/types';
import { net } from 'electron';
import { createSecretSet } from './secretRedactor';

const ANTHROPIC_VERSION = '2023-06-01';
const TIMEOUT_MS = 15000;
/** 连通性探测上限。1 会让 thinking 模型在思维链阶段直接超限（上游 502）。 */
const TEST_MAX_OUTPUT_TOKENS = 4096;

const OFFICIAL_ANTHROPIC_HOST = 'api.anthropic.com';

export function isOfficialAnthropicHost(urlOrBase: string): boolean {
  try {
    const parsed = new URL(urlOrBase);
    return parsed.hostname.toLowerCase() === OFFICIAL_ANTHROPIC_HOST;
  } catch {
    return false;
  }
}

export function resolveBase(config: ProviderApiConfig): string {
  const base = config.baseUrl.trim().replace(/\/+$/, '');
  return base || DEFAULT_BASE_URLS[config.api];
}

async function request(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Node/undici TLS 指纹会被 Cloudflare 拦成 403 挑战页（done.5111online.uk 已踩过）；
    // 聊天能通是因为 worker 装了系统代理。主进程拉模型必须走 Chromium net.fetch。
    // 动态 import：避免 providerApi → proxyConfig → agentHost 把 worker 入口拖进无关测试。
    const { getProxyConfig } = await import('./proxyConfig');
    await getProxyConfig().whenReady();
    return await net.fetch(url, {
      ...init,
      signal: init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function httpError(response: Response): string {
  return `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
}

export function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'AbortError' ? 'Request timed out' : error.message;
  }
  return String(error);
}

export async function listModels(
  config: ProviderApiConfig,
  extraHeaders?: Record<string, string>
): Promise<ListModelsResult> {
  const base = resolveBase(config);
  const key = config.apiKey.trim();
  try {
    if (isClassifierOnlyProvider(config)) {
      return {
        ok: true,
        models: (typesafeProvider().getAllModels?.() ?? []).map((model) => ({ id: model.id })),
      };
    }
    let url: string;
    let headers: Record<string, string> = {};
    switch (config.api) {
      case 'anthropic-messages':
        url = `${withVersionSegment(base, 'v1')}/models`;
        headers = { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION };
        break;
      case 'google-generative-ai':
        url = `${withVersionSegment(base, 'v1beta')}/models?key=${encodeURIComponent(key)}`;
        break;
      case 'ollama':
        url = `${base}/api/tags`;
        break;
      default:
        url = `${base}/models`;
        headers = { Authorization: `Bearer ${key}` };
    }
    if (extraHeaders) headers = { ...headers, ...extraHeaders };

    let response = await request(url, { headers, redirect: 'manual' });
    if (
      response.status === 401 &&
      config.api === 'anthropic-messages' &&
      !isOfficialAnthropicHost(url)
    ) {
      // 第三方 Anthropic 首次 401 时允许以 Bearer 替换 x-api-key 重试一次同一 URL（保留 anthropic-version）
      const retryHeaders: Record<string, string> = {
        Authorization: `Bearer ${key}`,
        'anthropic-version': ANTHROPIC_VERSION,
      };
      response = await request(url, { headers: retryHeaders, redirect: 'manual' });
    }

    if (!response.ok) return { ok: false, models: [], error: httpError(response) };

    const data = await response.json();
    if (!isValidModelListPayload(config.api, data)) {
      return { ok: false, models: [], error: 'Invalid model list response format' };
    }
    const models = extractModelEntries(config.api, data as Record<string, unknown>);
    return { ok: true, models };
  } catch (error) {
    const secrets = createSecretSet([config.apiKey]);
    return { ok: false, models: [], error: secrets.redactError(toMessage(error)) };
  }
}

/**
 * 各家 "OpenAI 兼容" 站与 Google 官方对上下文窗口 / 最大输出的字段名各不相同，
 * 按 "更具体的字段名优先" 依次探测（清单参考 DeepChat new-api 分支 + OpenRouter/Groq/Gemini）。
 * 官方 OpenAI / Anthropic 不返回这些字段，探不到就缺省，下游走 catalog/default 兜底。
 */
const CONTEXT_WINDOW_FIELDS = [
  'context_length',
  'contextLength',
  'input_token_limit',
  'max_input_tokens',
  'context_window',
  'context_size',
  'inputTokenLimit',
] as const;

const MAX_TOKENS_FIELDS = [
  'max_completion_tokens',
  'max_output_tokens',
  'output_token_limit',
  'max_tokens',
  'outputTokenLimit',
] as const;

/** 档位弱 → 强排序；端点可能给出 off/none、ultra 这类项目值域外的档 */
const THINKING_LEVEL_ORDER = MODEL_THINKING_LEVEL_OVERRIDES;

/**
 * 端点档位别名归一：`ultra` 是我们的 `max`（再高也没有），
 * `none` / `off` / `disabled` 指「关」，本项目用 reasoning 开关表达，不进档位集合。
 */
function normalizeThinkingLevel(value: unknown): ModelThinkingLevelOverride | undefined {
  if (typeof value !== 'string') return undefined;
  const level = value.trim().toLowerCase();
  if (level === 'ultra') return 'max';
  return (THINKING_LEVEL_ORDER as readonly string[]).includes(level)
    ? (level as ModelThinkingLevelOverride)
    : undefined;
}

/** 去重 + 按强弱排序；过滤后为空 = 未知（不落空数组），避免把「未知」写成「明确不支持」 */
function normalizeThinkingLevels(raw: unknown): ModelThinkingLevelOverride[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const levels = new Set<ModelThinkingLevelOverride>();
  for (const item of raw) {
    const level = normalizeThinkingLevel(item);
    if (level) levels.add(level);
  }
  if (levels.size === 0) return undefined;
  return THINKING_LEVEL_ORDER.filter((level) => levels.has(level));
}

const THINKING_LEVELS_FIELDS = [
  'reasoning_levels',
  'support_efforts',
  'supported_reasoning_levels',
] as const;

function readThinkingLevels(
  item: Record<string, unknown>
): ModelThinkingLevelOverride[] | undefined {
  for (const field of THINKING_LEVELS_FIELDS) {
    const value = item[field];
    if (value === undefined) continue;
    // supported_reasoning_levels 是 [{ effort }]；其余是字符串数组
    const raw =
      field === 'supported_reasoning_levels' && Array.isArray(value)
        ? value.map((entry) => asRecord(entry)?.effort)
        : value;
    const levels = normalizeThinkingLevels(raw);
    if (levels) return levels;
  }
  // Kimi 形状的嵌套声明：只有 support:true 才算「声明了档位」
  const nested = asRecord(item.think_efforts);
  if (nested?.support === true) return normalizeThinkingLevels(nested.valid_efforts);
  return undefined;
}

function readBooleanField(
  item: Record<string, unknown>,
  fields: readonly string[]
): boolean | undefined {
  for (const field of fields) {
    const value = item[field];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

/** 各协议的显示名字段不同：Gemini 的 name 是资源路径（等于我们的 id），不能当标签 */
const LABEL_FIELDS: Record<string, readonly string[]> = {
  'google-generative-ai': ['displayName', 'display_name'],
  ollama: [],
};

function readLabel(api: ModelApiKind, item: Record<string, unknown>): string | undefined {
  for (const field of LABEL_FIELDS[api] ?? ['display_name', 'name']) {
    const value = item[field];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/** modalities.input 里没有 image = 明确不支持；字段缺失才回落到 supports_image_in，最后才是未知 */
function readSupportsImage(item: Record<string, unknown>): boolean | undefined {
  const modalities = asRecord(item.modalities);
  const input = modalities?.input;
  if (Array.isArray(input)) {
    return input.some(
      (value) => typeof value === 'string' && value.trim().toLowerCase() === 'image'
    );
  }
  return readBooleanField(item, ['supports_image_in']);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstPositiveField(
  item: Record<string, unknown>,
  fields: readonly string[]
): number | undefined {
  for (const field of fields) {
    const value = positiveFiniteNumber(item[field]);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * 非正 / 非有限 / 非数字一律视为缺失，不留假数字。
 * 单条缺字段只丢该字段：一个模型没有 context_length 不能拖垮整份清单。
 */
function attachMetadata(
  api: ModelApiKind,
  id: string,
  item: Record<string, unknown>
): FetchedModel {
  // Kimi/OpenRouter 风格把窗口塞进 limit{context,output}；扁平字段优先
  const limit = asRecord(item.limit);
  const contextWindow =
    firstPositiveField(item, CONTEXT_WINDOW_FIELDS) ?? positiveFiniteNumber(limit?.context);
  let maxTokens =
    firstPositiveField(item, MAX_TOKENS_FIELDS) ?? positiveFiniteNumber(limit?.output);
  if (maxTokens === undefined && item.top_provider && typeof item.top_provider === 'object') {
    // OpenRouter 形状：最大输出藏在 top_provider 里
    maxTokens = firstPositiveField(item.top_provider as Record<string, unknown>, [
      'max_completion_tokens',
    ]);
  }
  const label = readLabel(api, item);
  const reasoning = readBooleanField(item, ['reasoning', 'supports_reasoning']);
  const thinkingLevels = readThinkingLevels(item);
  const supportsImage = readSupportsImage(item);
  return {
    id,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(thinkingLevels !== undefined ? { thinkingLevels } : {}),
    ...(supportsImage !== undefined ? { supportsImage } : {}),
  };
}

export function isValidModelListPayload(api: ModelApiKind, data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  if (api === 'google-generative-ai' || api === 'ollama') {
    return Array.isArray(obj.models);
  }
  return Array.isArray(obj.data);
}

export function extractModelEntries(
  api: ModelApiKind,
  data: Record<string, unknown>
): FetchedModel[] {
  // 条目可能是 null 或非对象，先过滤再取字段，避免响应结构异常时抛错
  const objects = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value)
      ? value.filter(
          (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
        )
      : [];

  if (api === 'ollama') {
    // /api/tags 不携带上下文信息（需要逐个调 /api/show，不在本列表接口里做）
    return objects(data.models)
      .map((item) => item.model ?? item.name)
      .filter((id): id is string => typeof id === 'string')
      .map((id) => ({ id }));
  }
  if (api === 'google-generative-ai') {
    return objects(data.models)
      .filter(
        (item): item is Record<string, unknown> & { name: string } => typeof item.name === 'string'
      )
      .map((item) => attachMetadata(api, item.name.replace(/^models\//, ''), item));
  }
  return objects(data.data)
    .filter((item): item is Record<string, unknown> & { id: string } => typeof item.id === 'string')
    .map((item) => attachMetadata(api, item.id, item));
}

export async function testProvider(
  config: ProviderApiConfig,
  modelId?: string
): Promise<TestProviderResult> {
  const started = Date.now();
  const model = modelId?.trim();

  if (isClassifierOnlyProvider(config)) {
    const catalog = typesafeProvider().getAllModels?.() ?? [];
    const classifier = catalog.find(
      (entry) => entry.type === 'classifier' && entry.id === (model || 'jev-latest')
    );
    if (classifier?.type !== 'classifier' || classifier.api !== 'typesafe-system-one') {
      return { ok: false, latencyMs: Date.now() - started, message: 'Classifier not found' };
    }
    const result = await classify(
      { ...classifier, baseUrl: resolveBase(config) },
      {
        state: { message: 'Connectivity check' },
        questions: {
          connected: {
            type: 'choice',
            instructions: 'Is this a connectivity check?',
            criteria: { yes: 'A connectivity check', no: 'Anything else' },
          },
        },
      },
      {
        apiKey: config.apiKey.trim(),
        maxRetries: 0,
        timeoutMs: TIMEOUT_MS,
        fetch: (url, init) => request(String(url), { ...init, redirect: 'manual' }),
      }
    );
    return {
      ok: result.stopReason === 'stop',
      latencyMs: Date.now() - started,
      message:
        result.stopReason === 'stop'
          ? 'Connected'
          : createSecretSet([config.apiKey]).redactError(result.errorMessage ?? 'Failed'),
    };
  }

  // 无模型可用时，退化为拉取模型列表做连通性检查
  if (!model) {
    const result = await listModels(config);
    return {
      ok: result.ok,
      latencyMs: Date.now() - started,
      message: result.ok ? 'Connected' : (result.error ?? 'Failed'),
    };
  }

  const base = resolveBase(config);
  const key = config.apiKey.trim();
  try {
    let url: string;
    let headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let body: unknown;

    switch (config.api) {
      case 'anthropic-messages':
        url = `${withVersionSegment(base, 'v1')}/messages`;
        headers = { ...headers, 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION };
        body = {
          model,
          max_tokens: TEST_MAX_OUTPUT_TOKENS,
          messages: [{ role: 'user', content: 'hi' }],
        };
        break;
      case 'google-generative-ai':
        url = `${withVersionSegment(base, 'v1beta')}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
        body = {
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
          generationConfig: { maxOutputTokens: TEST_MAX_OUTPUT_TOKENS },
        };
        break;
      case 'ollama':
        url = `${base}/api/chat`;
        body = { model, messages: [{ role: 'user', content: 'hi' }], stream: false };
        break;
      case 'openai-responses':
        url = `${base}/responses`;
        headers = { ...headers, Authorization: `Bearer ${key}` };
        body = { model, input: 'hi', max_output_tokens: TEST_MAX_OUTPUT_TOKENS };
        break;
      default:
        url = `${base}/chat/completions`;
        headers = { ...headers, Authorization: `Bearer ${key}` };
        body = {
          model,
          max_tokens: TEST_MAX_OUTPUT_TOKENS,
          messages: [{ role: 'user', content: 'hi' }],
        };
    }

    const response = await request(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const latencyMs = Date.now() - started;
    if (!response.ok) return { ok: false, latencyMs, message: httpError(response) };
    return { ok: true, latencyMs, message: model };
  } catch (error) {
    const secrets = createSecretSet([config.apiKey]);
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: secrets.redactError(toMessage(error)),
    };
  }
}
