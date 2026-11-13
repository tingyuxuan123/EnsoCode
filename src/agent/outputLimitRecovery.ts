import type { InlineExtension } from '@earendil-works/pi-coding-agent';

export const OUTPUT_LIMIT_RECOVERY_ATTEMPTS = 3;
export const OUTPUT_LIMIT_RESUME =
  'Output token limit hit. Resume directly — no apology, no recap. ' +
  'Pick up where the response was cut off. Break remaining work into smaller pieces.';
export const OUTPUT_LIMIT_SPLIT =
  'Your previous response hit the output token limit, so its tool calls were not executed. ' +
  'Do not re-issue the same large call: write a skeleton or a first part, ' +
  'then add the remaining content with smaller incremental edits.';

export function outputLimitRecovery(input: {
  outcome: string;
  stopReason?: string;
  outputTokens?: number;
  modelMaxTokens?: number;
  hasToolCalls: boolean;
  attempts: number;
}): 'resume' | 'split' | undefined {
  if (input.outcome !== 'completed' || input.stopReason !== 'length') return undefined;
  if (input.attempts >= OUTPUT_LIMIT_RECOVERY_ATTEMPTS) return undefined;
  if (input.hasToolCalls) return 'split';
  const { outputTokens, modelMaxTokens } = input;
  // 无可靠用量不猜；低于输出上限的 length 可能是上下文挤压，交给 SDK 压缩恢复。
  if (
    outputTokens === undefined ||
    modelMaxTokens === undefined ||
    !Number.isFinite(outputTokens) ||
    !Number.isFinite(modelMaxTokens) ||
    modelMaxTokens <= 0 ||
    outputTokens < modelMaxTokens
  )
    return undefined;
  return 'resume';
}

export const outputLimitRecoveryExtension: InlineExtension = {
  name: 'output-limit-recovery',
  hidden: true,
  factory: (pi) => {
    let attempts = 0;
    pi.on('agent_start', () => {
      attempts = 0;
    });
    pi.on('turn_end', (event, context) => {
      if (context.signal?.aborted || event.message.role !== 'assistant') return;
      const message = event.message;
      // 虚拟模型的上限不是实际路由模型的上限，按落盘回复的物理模型查目录。
      const model =
        context.modelRegistry.find(message.provider, message.model) ??
        (context.model?.provider === message.provider && context.model.id === message.model
          ? context.model
          : undefined);
      const action = outputLimitRecovery({
        outcome: event.outcome,
        stopReason: message.stopReason,
        outputTokens: message.usage?.output,
        modelMaxTokens: model?.maxTokens,
        hasToolCalls:
          event.toolResults.length > 0 || message.content.some((part) => part.type === 'toolCall'),
        attempts,
      });
      if (!action) return;
      attempts += 1;
      const entries = [
        ...event.entries,
        {
          type: 'custom_message' as const,
          customType: 'output-limit-recovery',
          content: action === 'resume' ? OUTPUT_LIMIT_RESUME : OUTPUT_LIMIT_SPLIT,
          display: false,
        },
      ];
      // 截断工具调用由 SDK 拒绝并接后续请求；这里只补指导，不重放或绕过执行校验。
      return action === 'resume' ? { entries, continue: true } : { entries };
    });
  },
};
