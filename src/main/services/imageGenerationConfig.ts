import { type ImageToolName, parseImageGenerationSettings } from '@shared/imageGeneration';
import {
  IMAGE_PROVIDER_ID,
  type ImageProviderSettings,
  parseImageProviderSettings,
} from '@shared/imageProvider';
import { isSecretReference } from '@shared/secretReference';
import type { ImageProviderConfig } from './imageGeneration/service';

export function resolveImageProvider(
  settings: unknown,
  tool: ImageToolName,
  independent?: { config: ImageProviderSettings; apiKey: string }
): ImageProviderConfig | null {
  const state =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const config = parseImageGenerationSettings(state.imageGeneration);
  const selected = tool === 'edit_image' ? config.imageToImage : config.textToImage;
  if (independent !== undefined) {
    const output = parseImageProviderSettings(independent.config);
    if (!output || !independent.apiKey || (tool === 'edit_image' && !output.imageToImage))
      return null;
    const modelId =
      selected?.providerId === IMAGE_PROVIDER_ID ? selected.modelId : output.models[0];
    if (!modelId || !output.models.includes(modelId)) return null;
    return { baseUrl: output.baseUrl, apiKey: independent.apiKey, modelId, output };
  }
  if (!selected || !Array.isArray(state.providers)) return null;
  for (const raw of state.providers) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const provider = raw as Record<string, unknown>;
    if (
      provider.id !== selected.providerId ||
      provider.enabled !== true ||
      provider.oauthAccountKey ||
      provider.oauthAccountPool ||
      typeof provider.baseUrl !== 'string' ||
      typeof provider.apiKey !== 'string' ||
      !provider.apiKey.trim() ||
      provider.apiKey.startsWith('enso-secret:') ||
      isSecretReference(provider.apiKey)
    )
      continue;
    return { baseUrl: provider.baseUrl, apiKey: provider.apiKey, modelId: selected.modelId };
  }
  return null;
}
