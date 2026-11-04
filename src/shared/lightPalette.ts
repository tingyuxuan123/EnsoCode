export type LightPalette = 'ocean' | 'mint-light';

export function parseLightPalette(value: unknown): LightPalette | null {
  return value === 'ocean' || value === 'mint-light' ? value : null;
}
