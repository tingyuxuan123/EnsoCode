import { INSERT_TEXT_MAX_BYTES, utf8Length } from '../browser/insertText';
import { isWpsDocumentUrl, parseWpsRangeAddress } from '../browser/wpsRange';
import type { PluginAgentSource } from './protocol';

/**
 * 插件可用的浏览器操作：只有宿主已实现的语义动作。
 * 不接受任意 CDP method、任意 JS、截图、下载或 tab 管理。
 */
export const PLUGIN_BROWSER_OPS = [
  'navigate',
  'snapshot',
  'read',
  'click',
  'fill',
  'press_key',
  'inspect',
  'copy_selection',
  'insert_text',
  'read_range',
] as const;
export type PluginBrowserOp = (typeof PLUGIN_BROWSER_OPS)[number];

/** 会改变页面状态的 op：调用前必须过会话写策略（Plan / 审批） */
export const PLUGIN_BROWSER_WRITE_OPS = [
  'navigate',
  'click',
  'fill',
  'press_key',
  'insert_text',
] as const satisfies readonly PluginBrowserOp[];

export interface PluginBrowserRequest {
  op: PluginBrowserOp;
  params: Record<string, unknown>;
}

/** Main 侧桥的入参：会话、项目与白名单都由 Main 推导后传入，插件不能自报 */
export interface PluginBrowserBridgeInput {
  /** Main 的 invocation 来源，不能由插件请求自报。仅 UI 的受限读取允许冷会话。 */
  kind?: 'tool' | 'ui' | 'event' | 'schedule' | 'export';
  sessionId: string | null;
  projectRoot: string | null;
  sessionGeneration?: string;
  agent?: PluginAgentSource;
  op: PluginBrowserOp;
  params: Record<string, unknown>;
  /** 清单声明的精确 host 白名单 */
  domains: readonly string[];
  signal: AbortSignal;
}

const MAX_URL = 8192;
const MAX_TEXT = 32 * 1024;
const MAX_SELECTOR = 512;
const MAX_KEY = 64;
const TAB_ID = /^[A-Za-z0-9:._-]{1,128}$/;
const REF = /^[A-Za-z0-9_-]{1,128}$/;

/** 控制字符一律拒绝：参数里的换行/NUL 只会让下游解析出歧义 */
const hasControl = (value: string): boolean => {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const onlyKeys = (params: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(params).every((key) => allowed.includes(key));

const tabIdOf = (params: Record<string, unknown>): string | null =>
  typeof params.tabId === 'string' && TAB_ID.test(params.tabId) ? params.tabId : null;

/**
 * 严格校验插件请求：`{op, params}` 只允许这两个键，params 必须是对象，
 * 每个 op 再按固定键集收窄。多余键（method / expression / cookies…）一律拒绝。
 */
export function parsePluginBrowserRequest(args: unknown): PluginBrowserRequest | null {
  if (!isRecord(args) || !onlyKeys(args, ['op', 'params'])) return null;
  const op = args.op;
  if (typeof op !== 'string' || !(PLUGIN_BROWSER_OPS as readonly string[]).includes(op))
    return null;
  const params = args.params;
  if (!isRecord(params)) return null;
  const normalized = normalizeParams(op as PluginBrowserOp, params);
  return normalized ? { op: op as PluginBrowserOp, params: normalized } : null;
}

function normalizeParams(
  op: PluginBrowserOp,
  params: Record<string, unknown>
): Record<string, unknown> | null {
  if (op === 'read_range') {
    if (!onlyKeys(params, ['url', 'address', 'tabId']) || !isWpsDocumentUrl(params.url))
      return null;
    const range = parseWpsRangeAddress(params.address);
    if (!range || (params.tabId !== undefined && !tabIdOf(params))) return null;
    return {
      url: params.url,
      address: range.address,
      ...(params.tabId ? { tabId: params.tabId } : {}),
    };
  }
  if (op === 'navigate') {
    if (!onlyKeys(params, ['url', 'newTab'])) return null;
    const url = params.url;
    if (typeof url !== 'string' || url.trim().length === 0 || url.length > MAX_URL) return null;
    if (params.newTab !== undefined && typeof params.newTab !== 'boolean') return null;
    return { url: url.trim(), ...(params.newTab === true ? { newTab: true } : {}) };
  }
  const tabId = tabIdOf(params);
  if (!tabId) return null;
  switch (op) {
    case 'snapshot':
    case 'read':
    case 'copy_selection':
      return onlyKeys(params, ['tabId']) ? { tabId } : null;
    case 'click': {
      if (!onlyKeys(params, ['tabId', 'ref'])) return null;
      const ref = params.ref;
      return typeof ref === 'string' && REF.test(ref) ? { tabId, ref } : null;
    }
    case 'fill': {
      if (!onlyKeys(params, ['tabId', 'ref', 'value'])) return null;
      const ref = params.ref;
      const value = params.value;
      if (typeof ref !== 'string' || !REF.test(ref)) return null;
      if (typeof value !== 'string' || value.length > MAX_TEXT) return null;
      return { tabId, ref, value };
    }
    case 'press_key': {
      if (!onlyKeys(params, ['tabId', 'key'])) return null;
      const key = params.key;
      return typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY && !hasControl(key)
        ? { tabId, key }
        : null;
    }
    case 'insert_text': {
      if (!onlyKeys(params, ['tabId', 'text'])) return null;
      const text = params.text;
      return typeof text === 'string' && utf8Length(text) <= INSERT_TEXT_MAX_BYTES
        ? { tabId, text }
        : null;
    }
    case 'inspect': {
      if (!onlyKeys(params, ['tabId', 'selector'])) return null;
      const selector = params.selector;
      if (typeof selector !== 'string' || selector.length === 0 || selector.length > MAX_SELECTOR)
        return null;
      return hasControl(selector) ? null : { tabId, selector };
    }
  }
}

/**
 * 插件只允许 HTTPS 且 host 精确命中清单白名单：
 * 不匹配子域、不做通配、不按后缀比较，也不接受明文 http / file / 内嵌凭证。
 */
export function pluginBrowserUrl(raw: string, domains: readonly string[]): URL | null {
  if (domains.length === 0) return null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  return host.length > 0 && domains.includes(host) ? url : null;
}
