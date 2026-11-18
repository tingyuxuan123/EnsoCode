/** 界面强调色预设；值写进 `html[data-accent]`，具体色值由 shared.css 定义 */
export const ACCENT_COLORS = [
  'fox',
  'ocean',
  'indigo',
  'violet',
  'teal',
  'amber',
  'graphite',
] as const;

export type AccentColor = (typeof ACCENT_COLORS)[number];

/** 默认是 Kettu 的狐狸橙：发送、当前选中、开关与聚焦用它。 */
export const DEFAULT_ACCENT_COLOR: AccentColor = 'fox';

export function parseAccentColor(value: unknown): AccentColor | null {
  return typeof value === 'string' && (ACCENT_COLORS as readonly string[]).includes(value)
    ? (value as AccentColor)
    : null;
}

/** 非法值（外部手改 settings.json / 旧版本载荷）落回默认值 */
export function resolveAccentColor(value: unknown): AccentColor {
  return parseAccentColor(value) ?? DEFAULT_ACCENT_COLOR;
}
