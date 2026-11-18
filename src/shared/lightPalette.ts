export const LIGHT_PALETTES = ['kettu-light', 'ocean', 'mint-light', 'cloud-light'] as const;

export type LightPalette = (typeof LIGHT_PALETTES)[number];

/** 默认是 Kettu 白；已有合法选择不变。 */
export const DEFAULT_LIGHT_PALETTE: LightPalette = 'kettu-light';

export function parseLightPalette(value: unknown): LightPalette | null {
  return LIGHT_PALETTES.find((palette) => palette === value) ?? null;
}
