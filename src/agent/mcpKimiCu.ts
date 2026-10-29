/**
 * Kimi CU MCP 的适配补丁：只补上游说明缺口、在 schema 校验前丢弃占位参数，不猜目标应用。
 *
 * 部分模型（真机会话里是 gpt-6.1-sol）会把所有可选字段填上零值：`app: ""`、`window_id: 0`、
 * `snapshot_id: ""`、`offset: 0, limit: 120`……Kimi CU 把这些当真实参数：空 app 过滤出空列表，
 * 0 号窗口找不到，出现 limit/offset/snapshot_id 就进入 AX 分页，而分页要求 mode=ax 且不接受截图参数。
 */

const PAGINATION_KEYS = ['limit', 'offset', 'snapshot_id'] as const;
const SCREENSHOT_KEYS = ['screenshot_detail', 'rect', 'additional_window_ids'] as const;
/** Kimi CU 里 0 不是合法的 pid / 窗口号，只会是占位 */
const ID_KEYS = new Set(['pid', 'window_id']);

export const KIMI_CU_JS_HINT =
  "\nInside a cell, call KimiCU through the bundled module: `let { kimiCU } = await import('@kimi/cu');` (let, because top-level bindings persist across cells) then e.g. `await kimiCU.get_app_state({ app: 'com.apple.finder' })`. Methods mirror the MCP tool names and take the same argument objects; there is no global `kimi` or `kimiCU`.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEmptyRect = (value: unknown): boolean =>
  isRecord(value) && !(Number(value.width) > 0 && Number(value.height) > 0);

function isPlaceholder(key: string, value: unknown): boolean {
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (ID_KEYS.has(key)) return value === 0;
  if (key === 'rect') return isEmptyRect(value);
  return false;
}

/** 只删除可选键，不新增、不改值；输出是输入 schema 的子集，可重复调用 */
export function normalizeKimiCuArguments(
  toolName: string,
  inputSchema: unknown,
  args: unknown
): unknown {
  if (!isRecord(args)) return args;
  const required = new Set(
    isRecord(inputSchema) && Array.isArray(inputSchema.required) ? inputSchema.required : []
  );
  const next = { ...args };
  const drop = (key: string) => {
    if (!required.has(key)) delete next[key];
  };
  for (const [key, value] of Object.entries(next)) {
    if (isPlaceholder(key, value)) drop(key);
  }
  if (toolName === 'get_app_state') {
    if (next.mode !== 'ax') PAGINATION_KEYS.forEach(drop);
    else if (PAGINATION_KEYS.some((key) => key in next)) SCREENSHOT_KEYS.forEach(drop);
  }
  return next;
}
