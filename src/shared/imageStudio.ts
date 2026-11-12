import { type GeneratedImage, IMAGE_PROMPT_MAX } from './imageGeneration';
import {
  type ImageProviderSettings,
  type ImageSizeMode,
  parseImageExtraParams,
} from './imageProvider';

/**
 * 图片工作台（image studio）共享契约。
 *
 * 工作台是独立会话：每个会话自己的目录里跑现有 `generateImage`，不经过聊天 worker，
 * 也不改动既有工具/配置行为。这里只放类型、常量与纯函数，Main 与 renderer 共用。
 */

export const IMAGE_STUDIO_RATIOS = [
  'auto',
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '9:16',
  '16:9',
] as const;
export type ImageStudioRatio = (typeof IMAGE_STUDIO_RATIOS)[number];

export const IMAGE_STUDIO_RESOLUTIONS = ['auto', '1k', '2k', '4k'] as const;
export type ImageStudioResolution = (typeof IMAGE_STUDIO_RESOLUTIONS)[number];

export const IMAGE_STUDIO_QUALITIES = ['auto', 'low', 'medium', 'high'] as const;
export type ImageStudioQuality = (typeof IMAGE_STUDIO_QUALITIES)[number];

export const IMAGE_STUDIO_FORMATS = ['auto', 'png', 'jpeg', 'webp'] as const;
export type ImageStudioFormat = (typeof IMAGE_STUDIO_FORMATS)[number];

/** 读取图片的两种变体：原图给大图预览，缩略图给历史列表，避免批量搬 32 MiB。 */
export const IMAGE_STUDIO_IMAGE_VARIANTS = ['thumb', 'original'] as const;
export type ImageStudioImageVariant = (typeof IMAGE_STUDIO_IMAGE_VARIANTS)[number];
export const IMAGE_STUDIO_THUMB_EDGE = 480;
export const IMAGE_STUDIO_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** 单次请求的参数覆盖：只作用于这一次生成，绝不写回全局 provider 配置。 */
export interface ImageStudioOptions {
  count: number;
  model: string;
  ratio: ImageStudioRatio;
  resolution: ImageStudioResolution;
  quality: ImageStudioQuality;
  format: ImageStudioFormat;
}

export interface ImageStudioSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  imageCount: number;
}

export type ImageStudioTurnStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface ImageStudioTurn {
  id: string;
  prompt: string;
  createdAt: number;
  options: ImageStudioOptions;
  sourceImageId?: string;
  status: ImageStudioTurnStatus;
  image?: GeneratedImage;
  /** 多图批次逐张落盘；失败/取消时保留已生成图片。旧单图使用 image。 */
  images?: GeneratedImage[];
  error?: string;
  size?: string;
}

export interface ImageStudioSession extends ImageStudioSummary {
  turns: ImageStudioTurn[];
  references: GeneratedImage[];
}

export interface ImageStudioGenerateRequest {
  sessionId: string;
  prompt: string;
  options: ImageStudioOptions;
  sourceImageId?: string;
}

export type ImageStudioResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const DEFAULT_IMAGE_STUDIO_OPTIONS: ImageStudioOptions = {
  count: 1,
  model: '',
  ratio: 'auto',
  resolution: 'auto',
  quality: 'auto',
  format: 'auto',
};
export default DEFAULT_IMAGE_STUDIO_OPTIONS;

export const IMAGE_STUDIO_PROMPT_MAX = IMAGE_PROMPT_MAX;
export const IMAGE_STUDIO_TITLE_MAX = 60;
const MODEL_MAX = 256;
const OPTION_KEYS = ['count', 'model', 'ratio', 'resolution', 'quality', 'format'] as const;
const REQUEST_KEYS = ['sessionId', 'prompt', 'options', 'sourceImageId'] as const;
const UUID_PATTERN = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
/** 分辨率 → 最长边（像素）。`4k` 对齐现有 `imageOutputParams` 的 3840。 */
const RESOLUTION_EDGE: Record<ImageStudioResolution, number> = {
  auto: 1024,
  '1k': 1024,
  '2k': 2048,
  '4k': 3840,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | null =>
  typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : null;

export function isImageStudioId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value.toLowerCase());
}

/** 会话 / 图片 id 只接受 UUID；大小写归一化，绝不接受路径片段。 */
export function parseImageStudioSessionId(value: unknown): string | null {
  return isImageStudioId(value) ? value.toLowerCase() : null;
}

/** 缺省（没传）读原图；其余非法值返回 null，由调用方拒绝。 */
export function parseImageStudioImageVariant(value: unknown): ImageStudioImageVariant | null {
  if (value === undefined) return 'original';
  return oneOf(IMAGE_STUDIO_IMAGE_VARIANTS, value);
}

/**
 * 缩略图目标尺寸：长边不超过 `edge`，不放大原图。
 * 宽高必须是正整数且有限，否则返回 null（坏数据不猜）。
 */
export function studioThumbnailSize(
  width: number,
  height: number,
  edge: number = IMAGE_STUDIO_THUMB_EDGE
): { width: number; height: number } | null {
  for (const value of [width, height, edge]) {
    if (!Number.isInteger(value) || value <= 0) return null;
  }
  const longest = Math.max(width, height);
  if (longest <= edge) return { width, height };
  const scale = edge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 单个选项字段的校验；缺失字段回落默认值，未知字段直接拒绝。 */
export function parseImageStudioOptions(value: unknown): ImageStudioOptions | null {
  if (!isRecord(value)) return null;
  if (Object.keys(value).some((key) => !(OPTION_KEYS as readonly string[]).includes(key)))
    return null;
  const count = value.count === undefined ? 1 : value.count;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 10) return null;
  const model = value.model === undefined ? '' : parseStudioModel(value.model);
  if (model === null) return null;
  const ratio = value.ratio === undefined ? 'auto' : oneOf(IMAGE_STUDIO_RATIOS, value.ratio);
  const resolution =
    value.resolution === undefined ? 'auto' : oneOf(IMAGE_STUDIO_RESOLUTIONS, value.resolution);
  const quality =
    value.quality === undefined ? 'auto' : oneOf(IMAGE_STUDIO_QUALITIES, value.quality);
  const format = value.format === undefined ? 'auto' : oneOf(IMAGE_STUDIO_FORMATS, value.format);
  if (!ratio || !resolution || !quality || !format) return null;
  return { count, model, ratio, resolution, quality, format };
}

export function studioTurnImages(
  turn: Pick<ImageStudioTurn, 'image' | 'images'>
): GeneratedImage[] {
  return turn.images ?? (turn.image ? [turn.image] : []);
}

function parseStudioModel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const model = value.trim();
  if (model.length > MODEL_MAX || /[\s\0\r\n]/.test(model)) return null;
  return model;
}

/** 生成请求：只收 id、prompt、options，绝不收任意磁盘路径。 */
export function parseImageStudioGenerateRequest(value: unknown): ImageStudioGenerateRequest | null {
  if (!isRecord(value)) return null;
  if (Object.keys(value).some((key) => !(REQUEST_KEYS as readonly string[]).includes(key)))
    return null;
  const sessionId = parseImageStudioSessionId(value.sessionId);
  if (!sessionId) return null;
  if (typeof value.prompt !== 'string') return null;
  const prompt = value.prompt.trim();
  if (!prompt || prompt.length > IMAGE_STUDIO_PROMPT_MAX) return null;
  const options = parseImageStudioOptions(value.options);
  if (!options) return null;
  const sourceImageId =
    value.sourceImageId === undefined ? undefined : parseImageStudioSessionId(value.sourceImageId);
  if (sourceImageId === null) return null;
  return { sessionId, prompt, options, ...(sourceImageId ? { sourceImageId } : {}) };
}

/** 侧栏标题：压缩空白后截断，空提示词返回空串由界面决定兜底文案。 */
export function imageStudioTitleFromPrompt(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim().slice(0, IMAGE_STUDIO_TITLE_MAX);
}

/**
 * 本次请求要发送的尺寸。
 *
 * - 比例和分辨率都是 auto：不指定尺寸，完全沿用 provider 默认；
 * - 比例 auto 但指定分辨率：按方图，最长边取分辨率；
 * - 比例固定、分辨率 auto：按 1k 基准给出该比例的宽高；
 * - 两者都固定：该比例下的最长边取分辨率。
 *
 * 宽高对齐到 16 的整数倍，落在 `validImageSize` 的 64..4096 内。
 */
export function studioRequestedSize(
  ratio: ImageStudioRatio,
  resolution: ImageStudioResolution
): string | undefined {
  if (ratio === 'auto' && resolution === 'auto') return undefined;
  const edge = RESOLUTION_EDGE[resolution];
  if (ratio === 'auto') return `${edge}x${edge}`;
  const [width, height] = ratio.split(':').map(Number);
  return `${align16((width * edge) / Math.max(width, height))}x${align16(
    (height * edge) / Math.max(width, height)
  )}`;
}

function align16(value: number): number {
  return Math.max(64, Math.round(value / 16) * 16);
}

/**
 * 组装本次请求的 provider 输出参数（只覆盖这一次，不回写全局配置）。
 *
 * 全 auto 时原样返回 provider 设置；否则把比例/分辨率折成 `imageOutputParams` 认识的
 * `sizeMode` + 请求尺寸，`quality` 与 `output_format` 按需覆盖。
 */
export function studioOutputSettings(
  base: ImageProviderSettings,
  options: ImageStudioOptions
): ImageProviderSettings {
  const resolution = options.resolution;
  const extra = parseImageExtraParams(base.extraParams);
  if (extra) {
    // Provider defaults yield to an explicit per-call studio choice.
    if (options.ratio !== 'auto' || resolution !== 'auto') delete extra.size;
    if (options.quality !== 'auto') delete extra.quality;
    if (options.format !== 'auto') extra.output_format = options.format;
  }
  const extraParams =
    extra &&
    (options.ratio !== 'auto' ||
      resolution !== 'auto' ||
      options.quality !== 'auto' ||
      options.format !== 'auto')
      ? JSON.stringify(extra)
      : base.extraParams;
  if (options.ratio === 'auto' && resolution === 'auto') {
    return {
      ...base,
      models: [...base.models],
      quality: options.quality === 'auto' ? base.quality : options.quality,
      extraParams,
    };
  }
  const sizeMode: ImageSizeMode = resolution === 'auto' ? 'request' : resolution;
  return {
    ...base,
    models: [...base.models],
    sizeMode,
    quality: options.quality === 'auto' ? base.quality : options.quality,
    extraParams,
  };
}
