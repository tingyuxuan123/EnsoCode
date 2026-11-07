/** 聊天排版只描述偏好；字号按既有宿主基线等比应用，不改变 html / shell。 */
export const CHAT_TYPOGRAPHY_PARTS = [
  'body',
  'headings',
  'table',
  'codeBlock',
  'inlineCode',
] as const;
export type ChatTypographyPart = (typeof CHAT_TYPOGRAPHY_PARTS)[number];
export const CHAT_FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type ChatFontWeight = (typeof CHAT_FONT_WEIGHTS)[number];
export const CHAT_FONT_SIZE_MIN = 8;
export const CHAT_FONT_SIZE_MAX = 32;
export interface ChatTypographyEntry {
  fontSize: number;
  fontWeight: ChatFontWeight;
}
export type ChatTypography = Record<ChatTypographyPart, ChatTypographyEntry>;

// Code 正文实际 15px、h1/h2 18px（h3 16px）、代码 11px；Bot 等宿主保留自己的基线。
export const CHAT_TYPOGRAPHY_DEFAULTS: Readonly<ChatTypography> = {
  body: { fontSize: 15, fontWeight: 400 },
  headings: { fontSize: 18, fontWeight: 600 },
  table: { fontSize: 15, fontWeight: 400 },
  codeBlock: { fontSize: 11, fontWeight: 400 },
  inlineCode: { fontSize: 11, fontWeight: 400 },
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function validSize(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= CHAT_FONT_SIZE_MIN &&
    value <= CHAT_FONT_SIZE_MAX
  );
}
function validWeight(value: unknown): value is ChatFontWeight {
  return CHAT_FONT_WEIGHTS.some((weight) => value === weight);
}

/** 本机旧设置或手改坏配置：逐字段降级，不转换字符串、不把坏值钳成有效偏好。 */
export function normalizeChatTypography(value: unknown): ChatTypography {
  const source = record(value);
  const result = {} as ChatTypography;
  for (const part of CHAT_TYPOGRAPHY_PARTS) {
    const entry = record(source?.[part]);
    result[part] = {
      fontSize: validSize(entry?.fontSize)
        ? entry.fontSize
        : CHAT_TYPOGRAPHY_DEFAULTS[part].fontSize,
      fontWeight: validWeight(entry?.fontWeight)
        ? entry.fontWeight
        : CHAT_TYPOGRAPHY_DEFAULTS[part].fontWeight,
    };
  }
  return result;
}

/** 配置导入 / IPC 写入边界：完整对象且无额外键，坏值一律拒绝。 */
export function parseChatTypography(value: unknown): ChatTypography | null {
  const source = record(value);
  if (!source || Object.keys(source).length !== CHAT_TYPOGRAPHY_PARTS.length) return null;
  for (const part of CHAT_TYPOGRAPHY_PARTS) {
    const entry = record(source[part]);
    if (
      !entry ||
      Object.keys(entry).length !== 2 ||
      !validSize(entry.fontSize) ||
      !validWeight(entry.fontWeight)
    )
      return null;
  }
  return normalizeChatTypography(source);
}

export type ChatTypographyVariables = Record<`--chat-${string}`, string>;
export function chatTypographyVariables(value: unknown): ChatTypographyVariables {
  const typography = normalizeChatTypography(value);
  const result: ChatTypographyVariables = {};
  const names: Record<ChatTypographyPart, string> = {
    body: 'body',
    headings: 'headings',
    table: 'table',
    codeBlock: 'code-block',
    inlineCode: 'inline-code',
  };
  for (const part of CHAT_TYPOGRAPHY_PARTS) {
    result[`--chat-${names[part]}-scale`] = String(
      typography[part].fontSize / CHAT_TYPOGRAPHY_DEFAULTS[part].fontSize
    );
    result[`--chat-${names[part]}-weight`] = String(typography[part].fontWeight);
  }
  result['--chat-table-relative-scale'] = String(
    typography.table.fontSize / 15 / (typography.body.fontSize / 15)
  );
  // 原表头比正文重100；保留层级，但不超过允许字重。
  result['--chat-table-header-weight'] = String(Math.min(900, typography.table.fontWeight + 100));
  result['--chat-small-heading-weight'] = String(
    Math.max(100, typography.headings.fontWeight - 200)
  );
  result['--chat-small-heading-relative-scale'] = String(
    typography.headings.fontSize / 18 / (typography.body.fontSize / 15)
  );
  return result;
}

/** 放在原有用户正文字号容器内，勿放在包裹 Markdown 的公共祖先上（避免二次缩放）。 */
export const chatBodyTypographyStyle = {
  fontSize: 'calc(1em * var(--chat-body-scale, 1))',
  fontWeight: 'var(--chat-body-weight, 400)',
};
export const chatInlineCodeTypographyStyle = {
  fontSize: 'calc(11rem / 14 * var(--chat-inline-code-scale, 1))',
  fontWeight: 'var(--chat-inline-code-weight, 400)',
};
export const chatCodeBlockTypographyStyle = {
  fontSize: 'calc(11rem / 14 * var(--chat-code-block-scale, 1))',
  fontWeight: 'var(--chat-code-block-weight, 400)',
};
