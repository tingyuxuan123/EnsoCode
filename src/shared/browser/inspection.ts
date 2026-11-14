/**
 * 插件浏览器检查：固定 DOM 脚本 + 固定投影。
 * 页面里只读可见文本、表单值和矩形，可选 data-enso-ref；不返回 HTML 属性、
 * cookie、storage，也不会执行插件传来的 JS。
 */
export const PLUGIN_INSPECT_LIMIT = 32;
const MAX_FIELD = 400;
/**
 * 表单值不静默截断：保留到 8001 字符，超出时打 `truncated: true`，
 * 供写回方（例如表格读取）拒绝而不是用被截断的文本覆盖页面。
 */
export const PLUGIN_INSPECT_MAX_VALUE = 8001;
const TAG = /^[a-z][a-z0-9-]{0,15}$/;
const REF = /^[A-Za-z0-9_-]{1,64}$/;
/** 只有这些标签会带 value；空串也保留，空格不能被吞掉 */
const VALUE_TAGS = new Set(['input', 'textarea', 'select']);

export interface PluginInspectEntry {
  tag: string;
  text: string;
  value?: string;
  ref?: string;
  /** value 超过 PLUGIN_INSPECT_MAX_VALUE 时为 true；此时不要用 value 写回 */
  truncated?: boolean;
  rect: { x: number; y: number; width: number; height: number };
}

/**
 * 选择器只作为 JSON 字符串字面量嵌入；脚本自身固定，不接受 method / expression。
 * 密码、隐藏、文件输入与 script/style 在页面侧就不进候选。
 */
export function pageInspectScript(selector: string): string {
  return `(() => {
  const LIMIT = ${PLUGIN_INSPECT_LIMIT};
  const MAX = ${MAX_FIELD};
  const MAX_VALUE = ${PLUGIN_INSPECT_MAX_VALUE};
  const selector = ${JSON.stringify(selector)};
  const out = [];
  let nodes;
  try {
    nodes = document.querySelectorAll(selector);
  } catch {
    return [];
  }
  for (const node of nodes) {
    if (out.length >= LIMIT) break;
    if (!node || node.nodeType !== 1) continue;
    const tag = String(node.tagName || '').toLowerCase();
    if (tag === 'script' || tag === 'style') continue;
    const type = String(node.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && (type === 'password' || type === 'hidden' || type === 'file')) continue;
    try {
      const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'))
        continue;
      if (
        typeof node.checkVisibility === 'function' &&
        !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      )
        continue;
    } catch {}
    const rect = node.getBoundingClientRect();
    const entry = {
      tag,
      text: String(node.innerText === undefined ? (node.textContent || '') : node.innerText)
        .replace(/\\s+/g, ' ')
        .trim()
        .slice(0, MAX),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const value = typeof node.value === 'string' ? node.value : '';
      // 空串与纯空格都是合法值：始终带 value，超长时截到 MAX_VALUE 并显式标记
      entry.value = value.slice(0, MAX_VALUE);
      if (value.length > MAX_VALUE) entry.truncated = true;
    }
    const ref = node.getAttribute('data-enso-ref');
    if (ref) entry.ref = String(ref);
    out.push(entry);
  }
  return out;
})()`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function parseRect(raw: unknown): PluginInspectEntry['rect'] | null {
  if (!isRecord(raw)) return null;
  const { x, y, width, height } = raw;
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) return null;
  return { x, y, width, height };
}

/** 页面结果在 Main 再收一次口：只留投影字段，未知键、危险标签与坏形状都丢弃 */
export function parseInspectEntries(raw: unknown): PluginInspectEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const entries: PluginInspectEntry[] = [];
  for (const item of raw) {
    if (entries.length >= PLUGIN_INSPECT_LIMIT) break;
    if (!isRecord(item)) continue;
    const tag = typeof item.tag === 'string' ? item.tag.toLowerCase() : '';
    if (!TAG.test(tag) || tag === 'script' || tag === 'style') continue;
    const rect = parseRect(item.rect);
    if (!rect) continue;
    const text = typeof item.text === 'string' ? item.text.slice(0, MAX_FIELD) : '';
    const isValueTag = VALUE_TAGS.has(tag);
    const rawValue = isValueTag ? (typeof item.value === 'string' ? item.value : '') : undefined;
    const overlong = rawValue !== undefined && rawValue.length > PLUGIN_INSPECT_MAX_VALUE;
    const value = rawValue === undefined ? undefined : rawValue.slice(0, PLUGIN_INSPECT_MAX_VALUE);
    const truncated = overlong || (isValueTag && item.truncated === true);
    const ref = typeof item.ref === 'string' && REF.test(item.ref) ? item.ref : undefined;
    entries.push({
      tag,
      text,
      ...(value !== undefined ? { value } : {}),
      ...(truncated ? { truncated: true } : {}),
      ...(ref !== undefined ? { ref } : {}),
      rect,
    });
  }
  return entries;
}
