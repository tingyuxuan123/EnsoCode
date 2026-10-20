import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { CODEMODE_FORBIDDEN_TOOLS, isNestedToolCallId } from './codemode';
import { type RunawayGuard, withRunawayGuard } from './runawayGuard';
import { withSourceReference } from './sourceReference';
import { type SystemReminderRegistry, withSystemReminders } from './systemReminder';
import { type ToolOutputBudget, withToolOutputBudget } from './toolOutputBudget';

/**
 * 模型可见结果的装饰（引用 / 输出外置 / runaway / system reminder）。
 * codemode 嵌套调用的结果只进脚本，跳过装饰：否则提醒被脚本吞掉、输出被外置成文件路径。
 * 脚本内禁用的工具标为 model-only：否则 pi 会在描述里宣传 `tools.<name>()`，诱导模型在脚本里调用后被拦截。
 */
export function decorateSessionTools(
  tools: ToolDefinition[],
  options: {
    reminders: SystemReminderRegistry;
    runaway: RunawayGuard;
    budget: ToolOutputBudget;
  }
): ToolDefinition[] {
  return tools.map((tool) => {
    const decorated = withSystemReminders(
      withRunawayGuard(
        withToolOutputBudget(withSourceReference(tool), options.budget),
        options.runaway
      ),
      options.reminders
    );
    return {
      ...decorated,
      ...(CODEMODE_FORBIDDEN_TOOLS.has(tool.name) ? { exposure: 'model-only' as const } : {}),
      execute: (toolCallId, params, signal, onUpdate, ctx) =>
        (isNestedToolCallId(toolCallId) ? tool : decorated).execute(
          toolCallId,
          params,
          signal,
          onUpdate,
          ctx
        ),
    };
  });
}
