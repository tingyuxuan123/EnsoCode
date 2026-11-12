export const IMAGE_PROVIDER_ID = 'builtin:openai-image';
export const IMAGE_SIZE_MODES = ['request', '1k', '2k', '4k', 'custom', 'omit'] as const;
export type ImageSizeMode = (typeof IMAGE_SIZE_MODES)[number];
export interface ImageProviderSettings {
  baseUrl: string;
  models: string[];
  imageToImage: boolean;
  sizeMode: ImageSizeMode;
  customSize: string;
  quality: string;
  extraParams: string;
}
export interface ImageProviderView {
  configured: boolean;
  config: ImageProviderSettings;
  hasApiKey: boolean;
  secureStorageAvailable: boolean;
}
export type ImageProviderResult<T> = { ok: true; value: T } | { ok: false; error: string };
export const DEFAULT_IMAGE_PROVIDER: ImageProviderSettings = {
  baseUrl: 'https://api.openai.com/v1',
  models: ['gpt-image-1'],
  imageToImage: true,
  sizeMode: 'request',
  customSize: '2048x2048',
  quality: '',
  extraParams: '',
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const protectedFields = new Set(['model', 'prompt', 'n', 'image', 'mask']);
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

export function normalizeImageProviderBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /[?#\r\n\0]/.test(value)) return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.toString().replace(/\/+$/, '')
      : null;
  } catch {
    return null;
  }
}
export function normalizeImageModelIds(value: unknown): string[] {
  const values =
    typeof value === 'string' ? value.split(/[\s,，]+/) : Array.isArray(value) ? value : [];
  return [
    ...new Set(
      values
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter(validModelId)
    ),
  ].slice(0, 32);
}
function validModelId(id: string): boolean {
  return id.length > 0 && id.length <= 256 && !/[\s\0]/.test(id);
}
export function parseImageProviderSettings(value: unknown): ImageProviderSettings | null {
  if (!isRecord(value) || Object.keys(value).length !== Object.keys(DEFAULT_IMAGE_PROVIDER).length)
    return null;
  const patch = parseImageProviderPatch(value);
  return patch ? { ...DEFAULT_IMAGE_PROVIDER, ...patch } : null;
}
export function parseImageProviderPatch(value: unknown): Partial<ImageProviderSettings> | null {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(DEFAULT_IMAGE_PROVIDER, key))
  )
    return null;
  const next: Partial<ImageProviderSettings> = {};
  if ('baseUrl' in value) {
    const url = normalizeImageProviderBaseUrl(value.baseUrl);
    if (!url) return null;
    next.baseUrl = url;
  }
  if ('models' in value) {
    if (
      !Array.isArray(value.models) ||
      value.models.length > 32 ||
      value.models.some((id) => typeof id !== 'string' || !validModelId(id.trim()))
    )
      return null;
    next.models = normalizeImageModelIds(value.models);
  }
  if ('imageToImage' in value) {
    if (typeof value.imageToImage !== 'boolean') return null;
    next.imageToImage = value.imageToImage;
  }
  if ('sizeMode' in value) {
    if (!IMAGE_SIZE_MODES.includes(value.sizeMode as ImageSizeMode)) return null;
    next.sizeMode = value.sizeMode as ImageSizeMode;
  }
  if ('customSize' in value) {
    const size = dimensions(value.customSize);
    if (!size) return null;
    next.customSize = `${size[0]}x${size[1]}`;
  }
  if ('quality' in value) {
    if (
      typeof value.quality !== 'string' ||
      value.quality.length > 32 ||
      /[\r\n\0]/.test(value.quality)
    )
      return null;
    next.quality = value.quality.trim();
  }
  if ('extraParams' in value) {
    if (typeof value.extraParams !== 'string' || !parseImageExtraParams(value.extraParams))
      return null;
    next.extraParams = value.extraParams.trim();
  }
  return next;
}
function dimensions(value: unknown): [number, number] | null {
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d{2,4})\s*[xX×*]\s*(\d{2,4})\s*$/.exec(value);
  if (!match) return null;
  const sides: [number, number] = [Number(match[1]), Number(match[2])];
  return sides.every((side) => side >= 64 && side <= 4096) ? sides : null;
}
export function parseImageExtraParams(value: string): Record<string, unknown> | null {
  if (value.length > 16_384) return null;
  if (!value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || Object.keys(parsed).length > 64) return null;
    const safe = (item: unknown, depth: number): boolean =>
      depth <= 8 &&
      (!item ||
        typeof item !== 'object' ||
        Object.entries(item).every(
          ([key, entry]) => !unsafeKeys.has(key) && safe(entry, depth + 1)
        ));
    if (!safe(parsed, 0)) return null;
    if (
      'size' in parsed &&
      parsed.size !== null &&
      !dimensions(parsed.size) &&
      parsed.size !== 'auto'
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}
export function imageOutputParams(
  config: ImageProviderSettings,
  requestedSize?: string
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  let size = dimensions(requestedSize);
  if (config.sizeMode === 'custom') size = dimensions(config.customSize);
  if (config.sizeMode === '1k' || config.sizeMode === '2k' || config.sizeMode === '4k') {
    const edge = { '1k': 1024, '2k': 2048, '4k': 3840 }[config.sizeMode];
    const [w, h] = size ?? [1, 1];
    const ratio = edge / Math.max(w, h);
    const align = (value: number) => Math.max(16, Math.round(value / 16) * 16);
    size = [align(w * ratio), align(h * ratio)];
  }
  if (config.sizeMode !== 'omit' && size) params.size = `${size[0]}x${size[1]}`;
  if (config.quality) params.quality = config.quality;
  for (const [key, value] of Object.entries(parseImageExtraParams(config.extraParams) ?? {}))
    if (!protectedFields.has(key)) params[key] = value;
  return params;
}
