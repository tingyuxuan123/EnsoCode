import { type ImageToolName, parseImageGenerationSettings } from '@shared/imageGeneration';
import { isSecretReference } from '@shared/secretReference';
import type { ImageProviderConfig } from './imageGeneration/service';

export function resolveImageProvider(
  settings: unknown,
  tool: ImageToolName
): ImageProviderConfig | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const state = settings as Record<string, unknown>;
  const config = parseImageGenerationSettings(state.imageGeneration);
  const selected = tool === 'edit_image' ? config.imageToImage : config.textToImage;
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
