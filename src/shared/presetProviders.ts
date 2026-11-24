/**
 * 预设服务商目录：内置「填都不用填就能用」的本机/官方入口。
 *
 * 与 `providerCatalog.ts` 的分工：那边是向导里供用户挑的厂商标（挑完仍要自己填 key），
 * 这边是已经知道地址与密钥、用户只需点一次启用的固定预设。预设启用后就是一条普通的
 * `ModelProvider`（带 `catalogId` 归组），不引入新的持久化结构。
 *
 * 目前只有 Magpie：用户本机 3425 端口上的聚合网关，密钥固定为 `magpie`，
 * 模型清单以它自己的 `/v1/models` 为准。
 */

import type { ModelApiKind } from './types/llm';

export interface PresetProviderDefinition {
  /** 同时用作 settings 条目的 `catalogId`，决定厂商分组与去重桶。 */
  id: string;
  name: string;
  api: ModelApiKind;
  baseUrl: string;
  /** 本机代理类服务的固定密钥：用户不用填，启用时直接带上。 */
  defaultApiKey: string;
  /** 只允许改端口（主机与路径固定），不做通用 URL 编辑。 */
  portEditable: boolean;
}

export const PRESET_PROVIDERS: readonly PresetProviderDefinition[] = [
  {
    id: 'magpie',
    name: 'Magpie',
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:3425/v1',
    defaultApiKey: 'magpie',
    portEditable: true,
  },
];

export function presetProviderById(id: string): PresetProviderDefinition | undefined {
  return PRESET_PROVIDERS.find((preset) => preset.id === id);
}

/** 只认 http/https：其它协议不是这类本机服务的入口，按「没有端口」处理。 */
function parseHttpUrl(baseUrl: string): URL | undefined {
  try {
    const parsed = new URL(baseUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** 端口号：地址没有显式端口或地址非法时返回空串，调用方据此当「没有端口」处理。 */
export function presetPortOf(baseUrl: string): string {
  return parseHttpUrl(baseUrl)?.port ?? '';
}

/** 1–65535 的纯数字。前后空白不放过：那通常是粘贴带进来的，不该静默接受。 */
export function isValidPresetPort(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * 换端口，保留协议、主机与路径。端口非法或地址非法一律返回 `null`，
 * 不产出「半个地址」让调用方去猜。
 */
export function withPresetPort(baseUrl: string, port: string): string | null {
  if (!isValidPresetPort(port)) return null;
  const parsed = parseHttpUrl(baseUrl);
  if (!parsed) return null;
  parsed.port = port;
  return parsed.toString().replace(/\/$/, '');
}
