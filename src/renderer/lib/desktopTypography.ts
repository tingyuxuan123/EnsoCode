import { type ChatTypography, normalizeChatTypography } from '@shared/chatTypography';

export const DEFAULT_MONO_FONT_FAMILY =
  '"JetBrains Mono Variable", ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace';

// Kettu 的界面 13px、线程正文 14px、输入框 15px、等宽文字 12px。
// 这里只定义桌面偏好；shared 的宿主缩放基线和手机默认值保持不变。
export const DESKTOP_CHAT_TYPOGRAPHY_DEFAULTS: Readonly<ChatTypography> = {
  body: { fontSize: 14, fontWeight: 400 },
  headings: { fontSize: 18, fontWeight: 600 },
  table: { fontSize: 14, fontWeight: 400 },
  codeBlock: { fontSize: 12, fontWeight: 400 },
  inlineCode: { fontSize: 12, fontWeight: 400 },
};

export function normalizeDesktopChatTypography(value: unknown): ChatTypography {
  return normalizeChatTypography(value, DESKTOP_CHAT_TYPOGRAPHY_DEFAULTS);
}
