/**
 * 插件 insert_text 的固定 DOM 校验：只认当前 `document.activeElement` 本身。
 * 不按 ref / selector 查找，也不自动 focus、选择或回车；插件负责先进入编辑态。
 *
 * `opacity: 0` 必须放行：真实 WPS 的 F2 编辑代理层（如 input#edit_proxy_runs）
 * 就是透明但仍接收键盘输入，snapshot / inspect 看不到它，而 activeElement 可用。
 */
export const INSERT_TEXT_MAX_BYTES = 32 * 1024;

export type InsertTextTargetReason =
  | 'none'
  | 'not-editable'
  | 'password'
  | 'hidden'
  | 'file'
  | 'readonly'
  | 'disabled'
  | 'invisible';

export type ActiveElementCheck =
  | { ok: true }
  | { ok: false; reason: InsertTextTargetReason; message: string };

const MESSAGES: Record<InsertTextTargetReason, string> = {
  none: 'No focused editable element. Focus the cell editor first (e.g. press F2).',
  'not-editable': 'Focused element is not input, textarea or contenteditable',
  password: 'Focused element is a password field',
  hidden: 'Focused element is a hidden input',
  file: 'Focused element is a file input',
  readonly: 'Focused element is read-only',
  disabled: 'Focused element is disabled',
  invisible: 'Focused element is not visible',
};

const REASONS = new Set<string>(Object.keys(MESSAGES));
const textEncoder = new TextEncoder();

export const utf8Length = (value: string): number => textEncoder.encode(value).length;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function pageActiveElementCheckScript(): string {
  return `(() => {
    const doc = document;
    const el = doc.activeElement;
    if (!el || el === doc.body || el === doc.documentElement) return { ok: false, reason: 'none' };
    const tag = String(el.tagName || '').toUpperCase();
    const isInput = tag === 'INPUT';
    const isTextarea = tag === 'TEXTAREA';
    if (!isInput && !isTextarea && el.isContentEditable !== true)
      return { ok: false, reason: 'not-editable' };
    if (isInput) {
      const type = String(el.type || 'text').toLowerCase();
      if (type === 'password') return { ok: false, reason: 'password' };
      if (type === 'hidden') return { ok: false, reason: 'hidden' };
      if (type === 'file') return { ok: false, reason: 'file' };
    }
    if (el.readOnly === true) return { ok: false, reason: 'readonly' };
    if (el.disabled === true) return { ok: false, reason: 'disabled' };
    const view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    const style = view && typeof view.getComputedStyle === 'function' ? view.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'))
      return { ok: false, reason: 'invisible' };
    const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    if (!rect || !(rect.width > 0 && rect.height > 0)) return { ok: false, reason: 'invisible' };
    return { ok: true };
  })()`;
}

/** 只接受闭集原因；页面的未知文本不回显给插件 */
export function parseActiveElementCheck(raw: unknown): ActiveElementCheck {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean')
    throw new Error('Page insert_text check returned an unexpected shape.');
  if (raw.ok === true) return { ok: true };
  const reason =
    typeof raw.reason === 'string' && REASONS.has(raw.reason) ? raw.reason : 'not-editable';
  const typed = reason as InsertTextTargetReason;
  return { ok: false, reason: typed, message: MESSAGES[typed] };
}
