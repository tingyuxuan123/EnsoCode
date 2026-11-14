/**
 * 插件只读「复制选区」：页面自己在 copy 事件里写 `DataTransfer.prototype.setData`，
 * 还会 stopImmediatePropagation 掉 window 的 copy 监听，所以只能在这段时间里
 * 临时替换原型方法捕获同一次复制的 text/plain 与表格元数据。
 *
 * 捕获脚本不调用原生 setData（不写系统剪贴板），也不调用原生 getData
 * （不读系统剪贴板）；成功、失败与取消都由 Main 在 finally 里撤销 hook。
 */
export const COPY_SELECTION_STATE_KEY = '__ensoPluginCopySelection';
export const COPY_SELECTION_MAX_BYTES = 64 * 1024;
/** 复制事件由浏览器进程异步派发，读取脚本最多等这么久 */
export const COPY_SELECTION_WAIT_MS = 1500;

export interface CopySelectionRange {
  sheetId: string;
  rowFrom: number;
  rowTo: number;
  colFrom: number;
  colTo: number;
}

export interface CopySelectionResult {
  text: string;
  range?: CopySelectionRange;
}

const TOKEN = /^[A-Za-z0-9_-]{8,64}$/;
const textEncoder = new TextEncoder();

const assertToken = (token: string): void => {
  if (typeof token !== 'string' || !TOKEN.test(token))
    throw new Error('Invalid copy_selection token');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const utf8Bytes = (value: string): number => textEncoder.encode(value).length;

/** 安装捕获 hook；页面上已有别的捕获时返回 busy，不覆盖页面的同名属性 */
export function pageCopySelectionInstallScript(token: string): string {
  assertToken(token);
  return `(() => {
    const key = ${JSON.stringify(COPY_SELECTION_STATE_KEY)};
    if (typeof DataTransfer !== 'function' || !DataTransfer.prototype) return { ok: false, reason: 'unsupported' };
    if (Object.prototype.hasOwnProperty.call(window, key)) return { ok: false, reason: 'busy' };
    const proto = DataTransfer.prototype;
    const originalSetData = proto.setData;
    const originalGetData = proto.getData;
    if (typeof originalSetData !== 'function' || typeof originalGetData !== 'function')
      return { ok: false, reason: 'unsupported' };
    const state = {
      token: ${JSON.stringify(token)},
      seen: false,
      text: '',
      meta: '',
      metaSeen: false,
      setData: originalSetData,
      getData: originalGetData,
      replacement: null,
      getReplacement: null
    };
    // 只捕获，不转交原生方法：setData 会写系统剪贴板，getData 会读系统剪贴板。
    const replacement = function (type, data) {
      if (this instanceof DataTransfer) {
        if (type === 'text/plain') {
          if (!state.seen) {
            state.seen = true;
            state.text = typeof data === 'string' ? data : data === undefined || data === null ? '' : String(data);
          }
          return undefined;
        }
        if (type === 'text/ksDocClipBoardInfo') {
          if (!state.metaSeen) {
            state.metaSeen = true;
            state.meta = typeof data === 'string' ? data : '';
          }
          return undefined;
        }
      }
      return undefined;
    };
    const getReplacement = function (type) {
      if (!(this instanceof DataTransfer)) return '';
      if (type === 'text/plain') return state.seen ? state.text : '';
      if (type === 'text/ksDocClipBoardInfo') return state.metaSeen ? state.meta : '';
      return '';
    };
    state.replacement = replacement;
    state.getReplacement = getReplacement;
    window[key] = state;
    proto.setData = replacement;
    proto.getData = getReplacement;
    return { ok: true };
  })()`;
}

/**
 * 读取并等待本次复制的捕获结果。`seen` 表示确实收到过 text/plain（空串也算），
 * 没收到时由 Main 明确报错，不冒充空内容。
 */
export function pageCopySelectionReadScript(
  token: string,
  waitMs: number = COPY_SELECTION_WAIT_MS
): string {
  assertToken(token);
  const wait =
    Number.isFinite(waitMs) && waitMs > 0
      ? Math.min(Math.floor(waitMs), COPY_SELECTION_WAIT_MS)
      : 0;
  return `(async () => {
    const key = ${JSON.stringify(COPY_SELECTION_STATE_KEY)};
    const state = window[key];
    if (!state || state.token !== ${JSON.stringify(token)}) return { ok: false, reason: 'lost' };
    const deadline = Date.now() + ${wait};
    while (!state.seen && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    return { ok: true, seen: state.seen, text: state.seen ? state.text : '', meta: state.metaSeen ? state.meta : '' };
  })()`;
}

/** 只在原型方法仍是我们的替换时还原；页面自己改过就不覆盖页面实现 */
export function pageCopySelectionCleanupScript(token: string): string {
  assertToken(token);
  return `(() => {
    const key = ${JSON.stringify(COPY_SELECTION_STATE_KEY)};
    const state = window[key];
    if (!state || state.token !== ${JSON.stringify(token)}) return { ok: false, reason: 'missing' };
    if (typeof DataTransfer === 'function' && DataTransfer.prototype) {
      const proto = DataTransfer.prototype;
      if (proto.setData === state.replacement) proto.setData = state.setData;
      if (proto.getData === state.getReplacement) proto.getData = state.getData;
    }
    try { delete window[key]; } catch { window[key] = undefined; }
    return { ok: true };
  })()`;
}

/**
 * 把页面返回的原始捕获投影成插件可见结果：只保留 text 与零基表格范围，
 * 元数据里的 fileId / linkId / HTML 等自定义字段一律丢弃。
 * text 超过 64KB（UTF-8）直接报错，不截断。
 */
export function parseCopySelectionResult(raw: unknown): CopySelectionResult {
  if (!isRecord(raw)) throw new Error('复制选区没有返回结果');
  if (raw.ok !== true)
    throw new Error(raw.reason === 'lost' ? '复制选区钩子已被页面移除' : '复制选区脚本执行失败');
  if (raw.seen !== true) throw new Error('没有捕获到本次复制的选区内容');
  const text = raw.text;
  if (typeof text !== 'string') throw new Error('复制选区文本格式不合法');
  if (utf8Bytes(text) > COPY_SELECTION_MAX_BYTES)
    throw new Error('复制选区文本超过 64KB（UTF-8），未截断');
  const range = parseRange(raw.meta);
  return range ? { text, range } : { text };
}

function parseRange(meta: unknown): CopySelectionRange | undefined {
  if (typeof meta !== 'string' || meta.length === 0 || meta.length > COPY_SELECTION_MAX_BYTES)
    return undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(meta);
  } catch {
    return undefined;
  }
  if (!isRecord(payload)) return undefined;
  const source = payload.srcRange;
  if (typeof source !== 'string') return undefined;
  const fields = new Map<string, string>();
  for (const part of source.split(',')) {
    const index = part.indexOf(':');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!name || fields.has(name)) continue;
    fields.set(name, part.slice(index + 1).trim());
  }
  const sheetId = fields.get('sheetStId');
  if (!sheetId || !/^[A-Za-z0-9._-]{1,64}$/.test(sheetId)) return undefined;
  const rowFrom = rangeInt(fields.get('rowFrom'));
  const rowTo = rangeInt(fields.get('rowTo'));
  const colFrom = rangeInt(fields.get('colFrom'));
  const colTo = rangeInt(fields.get('colTo'));
  if (rowFrom === undefined || rowTo === undefined) return undefined;
  if (colFrom === undefined || colTo === undefined) return undefined;
  if (rowFrom > rowTo || colFrom > colTo) return undefined;
  return { sheetId, rowFrom, rowTo, colFrom, colTo };
}

function rangeInt(raw: string | undefined): number | undefined {
  if (typeof raw !== 'string' || !/^\d{1,7}$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}
