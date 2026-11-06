export const LIGHT_PALETTES = ['ocean', 'mint-light', 'cloud-light'] as const;

export type LightPalette = (typeof LIGHT_PALETTES)[number];

export function parseLightPalette(value: unknown): LightPalette | null {
  return LIGHT_PALETTES.find((palette) => palette === value) ?? null;
}
