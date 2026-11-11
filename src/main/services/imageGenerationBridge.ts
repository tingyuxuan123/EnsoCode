import {
  IMAGE_REQUEST_TIMEOUT_MS,
  type ImageGenerationResult,
  type ImageToolName,
  parseImageGenerationArgs,
} from '@shared/imageGeneration';
import type { SessionIdentity } from '@shared/types/agent';
import type { ImageProviderConfig } from './imageGeneration/service';

export interface ImageRequest {
  identity: SessionIdentity;
  requestId: string;
  tool: ImageToolName;
  params: unknown;
}
interface Deps {
  allowed(identity: SessionIdentity): boolean;
  cwd(identity: SessionIdentity): string | null;
  config(tool: ImageToolName): ImageProviderConfig | null;
  run: typeof import('./imageGeneration/service').generateImage;
  reply(request: ImageRequest, result: ImageGenerationResult): void;
}
export class ImageGenerationBridge {
  private readonly seen = new Set<string>();
  private readonly pending = new Map<
    string,
    { request: ImageRequest; controller: AbortController }
  >();
  constructor(private readonly deps: Deps) {}
  async invoke(request: ImageRequest): Promise<void> {
    const fail = (error: string) =>
      this.deps.reply(request, { ok: false, error, retryable: false });
    if (!this.deps.allowed(request.identity)) {
      fail('Image generation is unavailable for this session or while planning.');
      return;
    }
    if (this.seen.has(request.requestId)) return; // Never settle an in-flight paid call twice.
    if (this.seen.size >= 100_000) {
      fail('Image request budget exhausted; restart the worker.');
      return;
    }
    this.seen.add(request.requestId);
    const args = parseImageGenerationArgs(request.tool, request.params);
    const cwd = this.deps.cwd(request.identity);
    const config = this.deps.config(request.tool);
    if (!args || !cwd || !config) {
      fail(
        'Configure an available image service/model in Settings → Built-in tools; edit_image requires exactly one workspace image source.'
      );
      return;
    }
    const controller = new AbortController();
    const entry = { request, controller };
    this.pending.set(request.requestId, entry);
    const timer = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS);
    timer.unref();
    try {
      const result = await this.deps.run(args, cwd, config, controller.signal);
      if (
        this.pending.get(request.requestId) === entry &&
        !controller.signal.aborted &&
        this.deps.allowed(request.identity)
      )
        this.deps.reply(request, result);
    } catch {
      if (this.pending.get(request.requestId) === entry && this.deps.allowed(request.identity))
        fail(
          controller.signal.aborted
            ? 'Image generation cancelled or timed out. Do not retry automatically.'
            : 'Image generation failed. Do not retry automatically.'
        );
    } finally {
      if (this.pending.get(request.requestId) === entry) this.pending.delete(request.requestId);
      clearTimeout(timer);
    }
  }
  cancel(identity?: SessionIdentity, requestId?: string): void {
    for (const [id, entry] of this.pending) {
      if (requestId && id !== requestId) continue;
      if (
        identity &&
        (entry.request.identity.sessionId !== identity.sessionId ||
          entry.request.identity.generation !== identity.generation)
      )
        continue;
      this.pending.delete(id);
      entry.controller.abort();
    }
  }
  reset(): void {
    this.cancel();
    this.seen.clear();
  }
}
