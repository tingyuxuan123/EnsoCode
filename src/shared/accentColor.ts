/** 界面强调色预设；值写进 `html[data-accent]`，具体色值由 globals.css 定义 */
export const ACCENT_COLORS = ['indigo', 'violet', 'teal', 'amber', 'graphite'] as const;

export type AccentColor = (typeof ACCENT_COLORS)[number];

export const DEFAULT_ACCENT_COLOR: AccentColor = 'indigo';

export function parseAccentColor(value: unknown): AccentColor | null {
  return typeof value === 'string' && (ACCENT_COLORS as readonly string[]).includes(value)
    ? (value as AccentColor)
    : null;
}

/** 非法值（外部手改 settings.json / 旧版本载荷）落回默认值 */
export function resolveAccentColor(value: unknown): AccentColor {
  return parseAccentColor(value) ?? DEFAULT_ACCENT_COLOR;
}
