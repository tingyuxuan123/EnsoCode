export const IMAGE_TOOL_NAMES = ['generate_image', 'edit_image'] as const;
export type ImageToolName = (typeof IMAGE_TOOL_NAMES)[number];
export const IMAGE_PROMPT_MAX = 16_000;
export const IMAGE_REQUEST_TIMEOUT_MS = 300_000;
export const GENERATED_IMAGE_DIR = '.xiaoman/images';
const extensions = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const;

export interface ImageGenerationInput {
  prompt: string;
  size?: string;
  sourceImageId?: string;
  sourceImagePath?: string;
}

export interface GeneratedImage {
  id: string;
  path: string;
  mimeType: string;
  parentId?: string;
}

export type ImageGenerationResult =
  | { ok: true; image: GeneratedImage }
  | { ok: false; error: string; retryable: boolean };

export interface ImageGenerationSelection {
  providerId: string;
  modelId: string;
}

export interface ImageGenerationSettings {
  textToImage: ImageGenerationSelection | null;
  imageToImage: ImageGenerationSelection | null;
}

export function parseImageGenerationSettings(value: unknown): ImageGenerationSettings {
  return {
    textToImage: parseImageGenerationSelection(record(value) ? value.textToImage : null),
    imageToImage: parseImageGenerationSelection(record(value) ? value.imageToImage : null),
  };
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function isImageToolName(value: unknown): value is ImageToolName {
  return value === 'generate_image' || value === 'edit_image';
}

export function isGeneratedImageId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
}

export function parseImageGenerationSelection(value: unknown): ImageGenerationSelection | null {
  if (!record(value) || Object.keys(value).some((key) => key !== 'providerId' && key !== 'modelId'))
    return null;
  const { providerId, modelId } = value;
  return typeof providerId === 'string' &&
    providerId.length <= 128 &&
    providerId.trim() &&
    typeof modelId === 'string' &&
    modelId.length <= 256 &&
    modelId.trim() &&
    !/[\r\n\0]/.test(modelId)
    ? { providerId: providerId.trim(), modelId: modelId.trim() }
    : null;
}

export function normalizeImageGenerationArgs(value: unknown): unknown {
  if (!record(value)) return value;
  const next = { ...value };
  for (const key of ['prompt', 'size', 'sourceImageId', 'sourceImagePath']) {
    if (typeof next[key] === 'string') next[key] = next[key].trim();
    if (key !== 'prompt' && (next[key] === '' || next[key] === null)) delete next[key];
  }
  if (typeof next.size === 'string') next.size = next.size.replace(/\s*[xX×]\s*/g, 'x');
  if (typeof next.sourceImageId === 'string') next.sourceImageId = next.sourceImageId.toLowerCase();
  return next;
}

export function parseImageGenerationArgs(
  tool: ImageToolName,
  value: unknown
): ImageGenerationInput | null {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) => !['prompt', 'size', 'sourceImageId', 'sourceImagePath'].includes(key)
    )
  )
    return null;
  const { prompt, size, sourceImageId, sourceImagePath } = value;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > IMAGE_PROMPT_MAX) return null;
  if (size !== undefined && (typeof size !== 'string' || !validImageSize(size))) return null;
  if (sourceImageId !== undefined && !isGeneratedImageId(sourceImageId)) return null;
  if (
    sourceImagePath !== undefined &&
    (typeof sourceImagePath !== 'string' ||
      !sourceImagePath.trim() ||
      sourceImagePath.length > 2048 ||
      sourceImagePath.includes('\0'))
  )
    return null;
  const sources = Number(sourceImageId !== undefined) + Number(sourceImagePath !== undefined);
  if (sources !== (tool === 'edit_image' ? 1 : 0)) return null;
  return {
    prompt,
    ...(size === undefined ? {} : { size }),
    ...(sourceImageId === undefined ? {} : { sourceImageId }),
    ...(sourceImagePath === undefined ? {} : { sourceImagePath }),
  };
}

export function validImageSize(size: string): boolean {
  const match = /^(\d{2,4})x(\d{2,4})$/.exec(size);
  return (
    !!match && [Number(match[1]), Number(match[2])].every((side) => side >= 64 && side <= 4096)
  );
}

export function parseGeneratedImage(value: unknown): GeneratedImage | null {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !['id', 'path', 'mimeType', 'parentId'].includes(key))
  )
    return null;
  const { id, path, mimeType, parentId } = value;
  if (
    !isGeneratedImageId(id) ||
    typeof mimeType !== 'string' ||
    !Object.hasOwn(extensions, mimeType) ||
    path !== `${GENERATED_IMAGE_DIR}/${id}.${extensions[mimeType as keyof typeof extensions]}` ||
    (parentId !== undefined && !isGeneratedImageId(parentId))
  )
    return null;
  return { id, path, mimeType, ...(parentId === undefined ? {} : { parentId }) };
}

export function parseImageGenerationResult(value: unknown): ImageGenerationResult | null {
  if (!record(value)) return null;
  if (value.ok === true) {
    const image = parseGeneratedImage(value.image);
    return image ? { ok: true, image } : null;
  }
  return value.ok === false &&
    typeof value.error === 'string' &&
    value.error.length > 0 &&
    value.error.length <= 500 &&
    typeof value.retryable === 'boolean'
    ? { ok: false, error: value.error, retryable: value.retryable }
    : null;
}

export function generatedImageFromOutput(output: string): GeneratedImage | null {
  if (output.length > 4096) return null;
  try {
    const result = parseImageGenerationResult(JSON.parse(output));
    return result?.ok ? result.image : null;
  } catch {
    return null;
  }
}
