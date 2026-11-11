import { randomUUID } from 'node:crypto';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import {
  IMAGE_PROMPT_MAX,
  IMAGE_REQUEST_TIMEOUT_MS,
  IMAGE_TOOL_NAMES,
  type ImageGenerationInput,
  type ImageGenerationResult,
  type ImageToolName,
  normalizeImageGenerationArgs,
  parseImageGenerationArgs,
  parseImageGenerationResult,
} from '@shared/imageGeneration';
import type { ChildSessionIdentity, SessionIdentity } from '@shared/types/agent';

interface Request {
  identity: SessionIdentity | ChildSessionIdentity;
  requestId: string;
  tool: ImageToolName;
  params: ImageGenerationInput;
}
interface Result {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** Credentials and HTTP stay in Main. Abort/timeout also cancel the remote request. */
export class ImageGenerationInvoker {
  private readonly pending = new Map<
    string,
    (result: ImageGenerationResult | Error, cancel?: boolean) => void
  >();
  constructor(
    private readonly identity: SessionIdentity | ChildSessionIdentity,
    private readonly emit: (request: Request) => void,
    private readonly cancel: (requestId: string) => void
  ) {}
  invoke(
    tool: ImageToolName,
    params: ImageGenerationInput,
    signal?: AbortSignal
  ): Promise<ImageGenerationResult> {
    if (signal?.aborted) return Promise.reject(new Error('Image generation aborted'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const onAbort = () => settle(new Error('Image generation aborted'), true);
      const timer = setTimeout(
        () => settle(new Error('Image generation timed out'), true),
        IMAGE_REQUEST_TIMEOUT_MS + 5000
      );
      const settle = (result: ImageGenerationResult | Error, cancel = false) => {
        if (!this.pending.delete(requestId)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (cancel) {
          try {
            this.cancel(requestId);
          } catch {
            /* Main also closes ended generations. */
          }
        }
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      this.pending.set(requestId, settle);
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        this.emit({ identity: this.identity, requestId, tool, params });
      } catch (error) {
        settle(error instanceof Error ? error : new Error('Image request failed'));
      }
    });
  }
  resolve(value: Result): boolean {
    const settle = this.pending.get(value.requestId);
    if (!settle) return false;
    const result = value.ok ? parseImageGenerationResult(value.result) : null;
    settle(result ?? new Error(value.error || 'Invalid image generation result'));
    return true;
  }
  cancelAll(reason = 'Image generation cancelled'): void {
    for (const settle of [...this.pending.values()]) settle(new Error(reason), true);
  }
}

export function createImageGenerationTools(
  deps: Pick<ImageGenerationInvoker, 'invoke'>
): ToolDefinition[] {
  return IMAGE_TOOL_NAMES.map((name) => ({
    name,
    label: name === 'edit_image' ? 'Edit image' : 'Generate image',
    description:
      name === 'generate_image'
        ? 'Generate an actual picture, illustration, icon or visual asset explicitly requested by the user. Expand the request into a detailed prompt (subject, style, lighting, composition, constraints). Not for implementing UI, websites, charts or diagrams: use code/design tools for those. Uses the configured OpenAI-compatible image service. Each call may be billed; never retry automatically. The result includes a workspace-relative image path and id; the user sees a preview in chat.'
        : 'Make a user-requested generative change to an existing image. Pass exactly one of sourceImageId (a previous generated image id) or sourceImagePath (an image inside the current workspace, including a local attachment copied there). Not for cropping/resizing/converting or screenshot annotation: use code for deterministic work. Each call may be billed; never retry automatically. Never send a private reference image unless the user asked for that edit.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          minLength: 1,
          maxLength: IMAGE_PROMPT_MAX,
          description:
            name === 'edit_image'
              ? 'Requested changes to the source image.'
              : 'Detailed prompt describing the picture.',
        },
        size: {
          type: 'string',
          pattern: '^\\d{2,4}x\\d{2,4}$',
          description:
            'WIDTHxHEIGHT, 64–4096 per side; default 1024x1024. The provider may restrict supported sizes.',
        },
        ...(name === 'edit_image'
          ? {
              sourceImageId: {
                type: 'string',
                description: 'UUID returned by generate_image/edit_image.',
              },
              sourceImagePath: {
                type: 'string',
                maxLength: 2048,
                description: 'Local image path inside the current workspace; absolute or relative.',
              },
            }
          : {}),
      },
      required: ['prompt'],
      additionalProperties: false,
    } as ToolDefinition['parameters'],
    prepareArguments: normalizeImageGenerationArgs as ToolDefinition['prepareArguments'],
    executionMode: 'sequential',
    promptGuidelines: [
      'Call image tools directly, never from a codemode script. Do not retry paid requests unless the user asks.',
    ],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async execute(_id, raw, signal) {
      const args = parseImageGenerationArgs(name, normalizeImageGenerationArgs(raw));
      if (!args)
        throw new Error(
          'Invalid image arguments. edit_image requires exactly one source; generate_image accepts none.'
        );
      const result = parseImageGenerationResult(await deps.invoke(name, args, signal));
      if (!result) throw new Error('Invalid image generation result');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: undefined,
        ...(!result.ok ? { isError: true } : {}),
      };
    },
  }));
}
