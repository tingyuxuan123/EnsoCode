export const LIGHT_PALETTES = ['ocean', 'mint-light', 'cloud-light'] as const;

export type LightPalette = (typeof LIGHT_PALETTES)[number];

export const DEFAULT_LIGHT_PALETTE: LightPalette = 'cloud-light';

export function parseLightPalette(value: unknown): LightPalette | null {
  return LIGHT_PALETTES.find((palette) => palette === value) ?? null;
}
