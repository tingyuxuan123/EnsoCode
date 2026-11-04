import type { Api, Context, Message, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { isXaiChatModelId } from '@shared/oauthCatalog';

function prepareContext(model: Model<Api>, context: Context): Context {
  if (model.api !== 'openai-responses') return context;
  const id = model.id.trim().replace(/^(?:xai|x-ai)\//i, '');
  if (id.includes('/') || !isXaiChatModelId(id)) return context;

  let messages: Message[] | undefined;
  for (const [index, message] of context.messages.entries()) {
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue;
    const content = message.content;
    const signedThinking = content.some(
      (block) => block?.type === 'thinking' && typeof block.thinkingSignature === 'string'
    );
    const hasText = content.some(
      (block) => block?.type === 'text' && typeof block.text === 'string'
    );
    const firstTool = content.findIndex((block) => block?.type === 'toolCall');
    if (!signedThinking || hasText || firstTool < 0) continue;

    const next = [...content];
    next.splice(firstTool, 0, { type: 'text', text: '' });
    messages ??= [...context.messages];
    messages[index] = { ...message, content: next };
  }
  return messages ? { ...context, messages } : context;
}

const installed = new WeakSet<ModelRuntime>();

/** Pi 1.4 的 complete 和虚拟 streamSimple 路由会动态调用物理 stream/streamSimple 出口。 */
export function installModelContextCompat(runtime: ModelRuntime): void {
  if (installed.has(runtime)) return;
  installed.add(runtime);
  if (typeof runtime.stream === 'function') {
    const stream = runtime.stream.bind(runtime);
    runtime.stream = (model, context, options) =>
      stream(model, prepareContext(model, context), options);
  }
  if (typeof runtime.streamSimple === 'function') {
    const streamSimple = runtime.streamSimple.bind(runtime);
    runtime.streamSimple = (model, context, options) =>
      streamSimple(model, prepareContext(model, context), options);
  }
}
