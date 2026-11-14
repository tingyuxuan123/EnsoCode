import type { CopySelectionRange } from './copySelection';

/**
 * 金山/WPS 表格固定读取：公共 read_range 与内部 op 共用同一套地址、URL 与 DOM 规则。
 * 只操作 `input.edit-box` 地址框，不向业务格输入；不接收任意脚本或 selector。
 */
export const WPS_RANGE_MAX_COLUMNS = 12; // A..L
export const WPS_RANGE_MAX_ROWS = 201; // 1..201
export const WPS_RANGE_MAX_CELLS = WPS_RANGE_MAX_COLUMNS * WPS_RANGE_MAX_ROWS;
/** 画布/地址框挂载的有界只读等待：loadURL 结束不代表 namebox 已挂载 */
export const WPS_RANGE_READY_TIMEOUT_MS = 10_000;
export const WPS_RANGE_READY_INTERVAL_MS = 150;

const WPS_HOSTS = new Set(['www.kdocs.cn', 'kdocs.cn', 'ap.wps.com']);
const WPS_DOC_PATH = /^\/(?:l\/|cms\/docs\/d\/)[A-Za-z0-9_-]+\/?$/;
const CELL = /^([A-Z]{1,2})([1-9][0-9]{0,2})$/;
const ADDRESS = /^([A-Z]{1,2}[1-9][0-9]{0,2})(?::([A-Z]{1,2}[1-9][0-9]{0,2}))?$/;

const NAME_BOX = 'input.edit-box';
const EDITOR = 'input.edit-proxy-runs, input#edit_proxy_runs';
const SHEET =
  '.et-status-sheet-item.selected .sheet-name, .sheet-active, [role="tab"][aria-selected="true"]';
const LOGIN_OVERLAY =
  '[role="dialog"], [class*="dialog"], [class*="login"], [class*="qrcode"], [class*="cover"], [class*="mask"]';
const LOADING = '[class*="loading"], [aria-busy="true"]';

export interface WpsRangeAddress {
  /** 归一化后的大写地址（单格或 A:B 矩形） */
  address: string;
  rowFrom: number;
  rowTo: number;
  colFrom: number;
  colTo: number;
}

export interface WpsRangeReadResult {
  text: string;
  range: CopySelectionRange;
  sheet: string;
  url: string;
  tabId: string;
}

/** A1:L201 内的单格或矩形；其余一律 null（含越界、倒序、多段与注入） */
export function parseWpsRangeAddress(value: unknown): WpsRangeAddress | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toUpperCase();
  if (raw.length === 0 || raw.length > 16) return null;
  const match = ADDRESS.exec(raw);
  if (!match) return null;
  const from = parseCell(match[1]);
  const to = match[2] ? parseCell(match[2]) : from;
  if (!from || !to) return null;
  if (!within(from) || !within(to)) return null;
  if (from.row > to.row || from.col > to.col) return null;
  const cells = (to.row - from.row + 1) * (to.col - from.col + 1);
  if (cells > WPS_RANGE_MAX_CELLS) return null;
  return {
    address: match[2] ? `${from.label}:${to.label}` : from.label,
    rowFrom: from.row,
    rowTo: to.row,
    colFrom: from.col,
    colTo: to.col,
  };
}

/** 只认固定 HTTPS 站点上的分享文档路径，不接受任意网页 */
export function isWpsDocumentUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const raw = value.trim();
  if (raw.length === 0 || raw.length > 8192) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (!WPS_HOSTS.has(url.hostname.toLowerCase())) return false;
  return WPS_DOC_PATH.test(url.pathname);
}

interface Cell {
  label: string;
  row: number;
  col: number;
}

function parseCell(raw: string): Cell | null {
  const match = CELL.exec(raw);
  if (!match) return null;
  let col = 0;
  for (const char of match[1]) col = col * 26 + (char.charCodeAt(0) - 64);
  return {
    label: `${match[1]}${match[2]}`,
    row: Number(match[2]) - 1,
    col: col - 1,
  };
}

function within(cell: Cell): boolean {
  return (
    cell.col >= 0 &&
    cell.col < WPS_RANGE_MAX_COLUMNS &&
    cell.row >= 0 &&
    cell.row < WPS_RANGE_MAX_ROWS
  );
}

const VISIBLE_HELPER = `
    const visible = (node, requireOpacity) => {
      if (!node) return false;
      const view = (node.ownerDocument && node.ownerDocument.defaultView) || window;
      const style = view && typeof view.getComputedStyle === 'function' ? view.getComputedStyle(node) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
      if (requireOpacity && style && style.opacity === '0') return false;
      const rect = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
      return !!rect && rect.width > 0 && rect.height > 0;
    };`;

const EDITING_HELPER = `
    const effectiveOpacity = (node) => {
      let current = node;
      let opacity = 1;
      for (let depth = 0; current && depth < 20; depth++, current = current.parentElement) {
        const view = (current.ownerDocument && current.ownerDocument.defaultView) || window;
        if (!view || typeof view.getComputedStyle !== 'function') return null;
        const style = view.getComputedStyle(current);
        if (!style) return null;
        if (style.display === 'none') return 0;
        if (style.visibility === 'hidden' || style.visibility === 'collapse') return 0;
        const raw = style.opacity === undefined || style.opacity === '' ? '1' : style.opacity;
        const value = Number.parseFloat(String(raw));
        if (!Number.isFinite(value)) return null;
        opacity *= Math.max(0, Math.min(1, value));
        if (opacity === 0) return 0;
      }
      return opacity;
    };
    const visiblyOpaque = (node) => {
      if (!visible(node, false)) return false;
      const opacity = effectiveOpacity(node);
      return opacity === null ? true : opacity > 0;
    };
    const editableText = (node) => {
      if (!node || node.readOnly === true || node.disabled === true) return false;
      const tag = String(node.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA') return true;
      if (tag === 'INPUT') {
        const type = String(node.type || 'text').toLowerCase();
        return type === '' || type === 'text' || type === 'search' || type === 'email' || type === 'url' || type === 'tel' || type === 'number';
      }
      return node.isContentEditable === true;
    };
    const inGrid = (node) => {
      try { return typeof node.closest === 'function' && !!node.closest('.et_grid_info'); } catch (error) { return false; }
    };
    const editingLayer = (doc, editors, boxes) => {
      // 真实 WPS 固定编辑层：#editDivContainer 正常选区为 opacity 0，F2 时可见。
      // 公式栏的 .editor-container/.canvas-editor-container 不属于该层，不能一概拦截。
      const layer = typeof doc.querySelector === 'function' ? doc.querySelector('#editDivContainer') : null;
      if (layer) {
        const opacity = effectiveOpacity(layer);
        if (opacity === null) return true;
        if (opacity > 0 && visible(layer, false)) return true;
      }
      for (const editor of editors) {
        if (editableText(editor) && visiblyOpaque(editor)) return true;
      }
      const active = doc.activeElement;
      if (!active || boxes.indexOf(active) >= 0 || editors.indexOf(active) >= 0) return false;
      return editableText(active) && visiblyOpaque(active) && inGrid(active);
    };`;

/**
 * 纯只读就绪检查：只分类，不 focus、不输入。
 * 编辑态/登录提示/遮挡立即失败；地址框缺失或未挂载且页面仍在加载时返回 loading，
 * 由 Host 做有界等待；已输入的内容绝不在等待里重放。
 */
export function pageWpsReadinessScript(): string {
  return `(() => {
    // __ensoWpsReady
    ${VISIBLE_HELPER}
    ${EDITING_HELPER}
    const doc = document;
    const editors = Array.prototype.slice.call(doc.querySelectorAll(${JSON.stringify(EDITOR)}));
    const loading =
      doc.readyState !== 'complete' ||
      Array.prototype.slice.call(doc.querySelectorAll(${JSON.stringify(LOADING)})).some((node) => visible(node, true));
    const all = Array.prototype.slice.call(doc.querySelectorAll(${JSON.stringify(NAME_BOX)}));
    const boxes = all.filter((node) => visible(node, false));
    // 透明焦点代理（normal-grid）不算编辑；只有固定编辑层/可见文本层才拦截。
    if (editingLayer(doc, editors, boxes)) return { ok: false, reason: 'editing' };
    // 登录层识别只用于两种情况：namebox 缺失且有可见登录提示，或遮罩真的盖住 namebox。
    const loginLayer = (node) => {
      let current = node;
      for (let depth = 0; current && depth < 6; depth++, current = current.parentElement) {
        if (current === doc.body || current === doc.documentElement) break;
        const tag = String(current.tagName || '').toUpperCase();
        if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT') continue;
        if (/login|qrcode|signin|sso/i.test(String(current.className || ''))) return true;
        if (/登录|扫码|sign\\s*in/i.test(String(current.textContent || ''))) return true;
      }
      return false;
    };
    const loginPromptVisible = () =>
      Array.prototype.slice.call(doc.querySelectorAll(${JSON.stringify(LOGIN_OVERLAY)})).some((node) => {
        if (!visible(node, true)) return false;
        const tag = String(node.tagName || '').toUpperCase();
        if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT') return false;
        return /登录|扫码|sign\\s*in/i.test(String(node.textContent || ''));
      });
    if (boxes.length !== 1) {
      if (boxes.length > 1) return { ok: false, reason: 'missing' };
      if (loginPromptVisible()) return { ok: false, reason: 'login' };
      if (all.length > 0) return { ok: false, reason: loading ? 'loading' : 'hidden' };
      return { ok: false, reason: loading ? 'loading' : 'missing' };
    }
    const box = boxes[0];
    const rect = box.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const hit = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(x, y) : null;
    if (!hit || !(hit === box || (typeof box.contains === 'function' && box.contains(hit)))) {
      // 地址框被登录遮罩挡住才算登录失败；可见但不挡地址框的登录 banner 不影响只读
      if (hit && loginLayer(hit)) return { ok: false, reason: 'login' };
      return { ok: false, reason: loading ? 'loading' : 'covered' };
    }
    // 返回受验证中心点：Host 用它发原生指针点击，让 RenderWidget 拿到键盘焦点
    return { ok: true, x: x, y: y };
  })()`;
}

/**
 * 准备：拒绝已有编辑态/焦点编辑代理；确认地址框唯一可见、未被提示遮挡，
 * 然后固定 focus + 全选地址框内容。不发送 F2，不碰业务格。
 */
export function pageWpsRangePrepareScript(): string {
  return `(() => {
    // __ensoWpsPrepare
    ${VISIBLE_HELPER}
    ${EDITING_HELPER}
    const doc = document;
    const editors = Array.prototype.slice.call(doc.querySelectorAll(${JSON.stringify(EDITOR)}));
    const all = Array.prototype.slice.call(doc.querySelectorAll(${JSON.stringify(NAME_BOX)}));
    const boxes = all.filter((node) => visible(node, false));
    if (editingLayer(doc, editors, boxes)) return { ok: false, reason: 'editing' };
    if (boxes.length === 0) return { ok: false, reason: all.length === 0 ? 'missing' : 'hidden' };
    if (boxes.length !== 1) return { ok: false, reason: 'missing' };
    const box = boxes[0];
    if (box.disabled === true || box.readOnly === true) return { ok: false, reason: 'hidden' };
    const rect = box.getBoundingClientRect();
    const hit = typeof doc.elementFromPoint === 'function'
      ? doc.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      : null;
    if (!hit || !(hit === box || (typeof box.contains === 'function' && box.contains(hit))))
      return { ok: false, reason: 'covered' };
    box.focus();
    if (doc.activeElement !== box) return { ok: false, reason: 'focus' };
    if (typeof box.select === 'function') box.select();
    else if (typeof box.setSelectionRange === 'function') box.setSelectionRange(0, String(box.value || '').length);
    if (typeof box.selectionStart === 'number' && typeof box.selectionEnd === 'number') {
      const length = String(box.value || '').length;
      if (box.selectionStart !== 0 || box.selectionEnd !== length) return { ok: false, reason: 'selection' };
    }
    return { ok: true };
  })()`;
}

/**
 * Enter 前复查：焦点必须仍在地址框、值必须等于已校验地址、地址框仍未被遮挡。
 * 任一不满足就不按 Enter，避免把地址提交进业务格。
 */
export function pageWpsRangeVerifyScript(address: string): string {
  return `(() => {
    // __ensoWpsVerify
    ${VISIBLE_HELPER}
    const doc = document;
    const expected = ${JSON.stringify(address)};
    const boxes = Array.prototype.slice.call(doc.querySelectorAll(${JSON.stringify(NAME_BOX)}));
    const box = boxes.length === 1 ? boxes[0] : null;
    if (!box || doc.activeElement !== box) return { ok: false, reason: 'blurred' };
    if (String(box.value || '').toUpperCase() !== expected) return { ok: false, reason: 'value' };
    if (!visible(box, false)) return { ok: false, reason: 'hidden' };
    const rect = box.getBoundingClientRect();
    const hit = typeof doc.elementFromPoint === 'function'
      ? doc.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      : null;
    if (!hit || !(hit === box || (typeof box.contains === 'function' && box.contains(hit))))
      return { ok: false, reason: 'covered' };
    return { ok: true };
  })()`;
}

/** 只读高亮工作表名：真实页 .sheet-name 与夹具 .sheet-active 都兼容 */
export function pageWpsSheetScript(): string {
  return `(() => {
    // __ensoWpsSheet
    const names = [];
    for (const node of Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(SHEET)}))) {
      const name = String(node.textContent || '').trim();
      if (name && names.indexOf(name) < 0) names.push(name);
    }
    if (names.length !== 1) return { ok: false, reason: 'sheet' };
    return { ok: true, sheet: names[0] };
  })()`;
}

/**
 * 原生输入前的只读复查：prepare 与 insertText 之间存在异步间隔，
 * 必须确认焦点、全选与命中都还在同一个 namebox，否则不向未知元素输入。
 */
export function pageWpsRangeRecheckScript(): string {
  return `(() => {
    // __ensoWpsRecheck
    ${VISIBLE_HELPER}
    const doc = document;
    const boxes = Array.prototype.slice.call(doc.querySelectorAll(${JSON.stringify(NAME_BOX)}));
    if (boxes.length !== 1 || !visible(boxes[0], false)) return { ok: false, reason: 'hidden' };
    const box = boxes[0];
    if (doc.activeElement !== box) return { ok: false, reason: 'blurred' };
    if (typeof box.selectionStart === 'number' && typeof box.selectionEnd === 'number') {
      const length = String(box.value || '').length;
      if (box.selectionStart !== 0 || box.selectionEnd !== length)
        return { ok: false, reason: 'selection' };
    }
    const rect = box.getBoundingClientRect();
    const hit = typeof doc.elementFromPoint === 'function'
      ? doc.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      : null;
    if (!hit || !(hit === box || (typeof box.contains === 'function' && box.contains(hit))))
      return { ok: false, reason: 'covered' };
    return { ok: true };
  })()`;
}

export type WpsRangePrepareReason =
  | 'editing'
  | 'missing'
  | 'hidden'
  | 'covered'
  | 'focus'
  | 'selection';
export type WpsRangeVerifyReason = 'blurred' | 'value' | 'hidden' | 'covered';
export type WpsRangeReadyReason =
  | 'loading'
  | 'editing'
  | 'login'
  | 'covered'
  | 'hidden'
  | 'missing';
export type WpsRangeRecheckReason = 'blurred' | 'selection' | 'hidden' | 'covered';

const READY_MESSAGES: Record<WpsRangeReadyReason, string> = {
  loading: '表格画布仍在加载，请稍后重试',
  editing: '表格正在编辑中，请先按 Escape 退出编辑再读取',
  login: '文档需要登录，请先在浏览器完成登录后再读取',
  covered: '地址框被页面提示挡住，请先关闭提示再读取',
  hidden: '单元格地址框不可见，已停止',
  missing: '无法唯一确认单元格地址框，已停止',
};

const PREPARE_MESSAGES: Record<WpsRangePrepareReason, string> = {
  editing: '表格正在编辑中，请先按 Escape 退出编辑再读取',
  missing: '无法唯一确认单元格地址框，已停止',
  hidden: '单元格地址框不可见，已停止',
  covered: '地址框被页面提示挡住，请先关闭提示再读取',
  focus: '无法把焦点放到地址框，已停止',
  selection: '无法全选地址框内容，已停止',
};

const VERIFY_MESSAGES: Record<WpsRangeVerifyReason, string> = {
  blurred: '地址框焦点已丢失，未按 Enter，不会把地址写进业务格',
  value: '地址输入未生效，未按 Enter，不会把地址写进业务格',
  hidden: '地址框在输入后不可见，未按 Enter',
  covered: '地址框被页面提示挡住，未按 Enter',
};

const RECHECK_MESSAGES: Record<WpsRangeRecheckReason, string> = {
  blurred: '地址框焦点已变化，未输入任何内容，已停止',
  selection: '地址框选择已变化，未输入任何内容，已停止',
  hidden: '地址框不可见，未输入任何内容，已停止',
  covered: '地址框被提示挡住，未输入任何内容，已停止',
};

const SHEET_MESSAGE = '无法确认当前唯一高亮工作表，请先在表格里手动选中目标工作表';

const PREPARE_REASONS = new Set<string>(Object.keys(PREPARE_MESSAGES));
const VERIFY_REASONS = new Set<string>(Object.keys(VERIFY_MESSAGES));
const READY_REASONS = new Set<string>(Object.keys(READY_MESSAGES));
const RECHECK_REASONS = new Set<string>(Object.keys(RECHECK_MESSAGES));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export type WpsRangeReadyCheck =
  | { ok: true; x: number; y: number }
  | { ok: false; reason: WpsRangeReadyReason; message: string };

export function parseWpsRangeReady(raw: unknown): WpsRangeReadyCheck {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean')
    throw new Error('Page read_range readiness returned an unexpected shape.');
  if (raw.ok === true) {
    const { x, y } = raw;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0 ||
      x > 100_000 ||
      y > 100_000
    )
      throw new Error('Page read_range readiness returned an unexpected point.');
    return { ok: true, x, y };
  }
  const reason =
    typeof raw.reason === 'string' && READY_REASONS.has(raw.reason) ? raw.reason : 'missing';
  const typed = reason as WpsRangeReadyReason;
  return { ok: false, reason: typed, message: READY_MESSAGES[typed] };
}

export type WpsRangePrepareCheck =
  | { ok: true }
  | { ok: false; reason: WpsRangePrepareReason; message: string };

export function parseWpsRangePrepare(raw: unknown): WpsRangePrepareCheck {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean')
    throw new Error('Page read_range prepare returned an unexpected shape.');
  if (raw.ok === true) return { ok: true };
  const reason =
    typeof raw.reason === 'string' && PREPARE_REASONS.has(raw.reason) ? raw.reason : 'hidden';
  const typed = reason as WpsRangePrepareReason;
  return { ok: false, reason: typed, message: PREPARE_MESSAGES[typed] };
}

export type WpsRangeVerifyCheck =
  | { ok: true }
  | { ok: false; reason: WpsRangeVerifyReason; message: string };

export function parseWpsRangeVerify(raw: unknown): WpsRangeVerifyCheck {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean')
    throw new Error('Page read_range verify returned an unexpected shape.');
  if (raw.ok === true) return { ok: true };
  const reason =
    typeof raw.reason === 'string' && VERIFY_REASONS.has(raw.reason) ? raw.reason : 'blurred';
  const typed = reason as WpsRangeVerifyReason;
  return { ok: false, reason: typed, message: VERIFY_MESSAGES[typed] };
}

export type WpsRangeRecheckCheck =
  | { ok: true }
  | { ok: false; reason: WpsRangeRecheckReason; message: string };

export function parseWpsRangeRecheck(raw: unknown): WpsRangeRecheckCheck {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean')
    throw new Error('Page read_range recheck returned an unexpected shape.');
  if (raw.ok === true) return { ok: true };
  const reason =
    typeof raw.reason === 'string' && RECHECK_REASONS.has(raw.reason) ? raw.reason : 'blurred';
  const typed = reason as WpsRangeRecheckReason;
  return { ok: false, reason: typed, message: RECHECK_MESSAGES[typed] };
}

export type WpsRangeSheetCheck = { ok: true; sheet: string } | { ok: false; message: string };

export function parseWpsRangeSheet(raw: unknown): WpsRangeSheetCheck {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean')
    throw new Error('Page read_range sheet returned an unexpected shape.');
  if (raw.ok !== true) return { ok: false, message: SHEET_MESSAGE };
  const sheet = typeof raw.sheet === 'string' ? raw.sheet.trim() : '';
  if (sheet.length === 0) return { ok: false, message: SHEET_MESSAGE };
  if (sheet.length > 128) throw new Error('Page read_range returned an unexpected sheet name.');
  for (const char of sheet) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f)
      throw new Error('Page read_range returned an unexpected sheet name.');
  }
  return { ok: true, sheet };
}
