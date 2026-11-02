import { createHash } from 'node:crypto';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { prependToolText, toolResultIsError, toolResultText } from './systemReminder';

export type RunawaySignal =
  | 'exact_action_repeat'
  | 'same_error_family'
  | 'polling_repeat'
  | 'unchanged_progress_repeat';

const THRESHOLD = 3;

interface Streak {
  key: string;
  count: number;
}

function bump(streak: Streak, key: string): Streak {
  if (!key) return { key: '', count: 0 };
  return key === streak.key ? { key, count: streak.count + 1 } : { key, count: 1 };
}

function fingerprint(value: unknown): string {
  try {
    const serialized = JSON.stringify(value, (_key, nested) => {
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return Object.fromEntries(
          Object.keys(nested as Record<string, unknown>)
            .sort()
            .map((key) => [key, (nested as Record<string, unknown>)[key]])
        );
      }
      return nested;
    });
    // 比较完整值，不能因长参数或输出的前缀相同而吞掉尾部进展；只留定长摘要。
    return serialized === undefined ? '' : createHash('sha256').update(serialized).digest('hex');
  } catch {
    return '';
  }
}

function errorFamily(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.slice(0, 80) || 'error';
}

export function runawayReminderText(kind: RunawaySignal): string {
  const guidance =
    kind === 'polling_repeat'
      ? 'Three task_output reads for the same task have returned an unchanged status and output cursor. Avoid repeated polling; you will be notified automatically and this conversation will resume when the background task completes.'
      : kind === 'same_error_family'
        ? `[runaway guard] The same error family has now occurred ${THRESHOLD} times. Do not retry the identical failing action. Inspect the error, change the approach, or stop.`
        : kind === 'unchanged_progress_repeat'
          ? `[runaway guard] ${THRESHOLD} consecutive tool results made no observable progress. Stop repeating the same step; inspect what you already have and change approach.`
          : `[runaway guard] The immediately repeated tool action has now occurred ${THRESHOLD} times with the same arguments and the same result. Do not repeat it unchanged. Inspect the results already returned and take a different next step.`;
  return (
    `<system-reminder>\n${guidance}\n` +
    'This reminder applies only to the current Turn. Do not save or generalize it into Memory, Skills, or other persistent instructions.\n' +
    '</system-reminder>'
  );
}

export class RunawayGuard {
  private action: Streak = { key: '', count: 0 };
  private result: Streak = { key: '', count: 0 };
  private error: Streak = { key: '', count: 0 };
  private poll: Streak = { key: '', count: 0 };
  private reminded = false;

  resetTurn(): void {
    this.action = { key: '', count: 0 };
    this.result = { key: '', count: 0 };
    this.error = { key: '', count: 0 };
    this.poll = { key: '', count: 0 };
    this.reminded = false;
  }

  observe(
    toolName: string,
    args: unknown,
    result: { text: string; isError?: boolean }
  ): string | undefined {
    if (this.reminded) return undefined;
    const polling = toolName === 'task_output';
    if (polling) {
      const taskId =
        args && typeof args === 'object' && !Array.isArray(args)
          ? String((args as { taskId?: unknown }).taskId ?? '')
          : '';
      this.poll = bump(this.poll, `${taskId}\0${fingerprint(result.text)}`);
      this.action = { key: '', count: 0 };
      this.result = { key: '', count: 0 };
    } else if (toolName === 'computer') {
      this.action = { key: '', count: 0 };
      this.result = result.isError
        ? { key: '', count: 0 }
        : bump(this.result, fingerprint(result.text));
      this.poll = { key: '', count: 0 };
    } else {
      const actionKey = `${toolName}\0${fingerprint(args)}`;
      const outcome = result.isError ? errorFamily(result.text) : fingerprint(result.text);
      this.action = bump(
        this.action,
        `${actionKey}\0${result.isError ? 'error' : 'ok'}\0${outcome}`
      );
      // edit/write/bash 等不同动作可能都只返回同一条成功回执，不能据此断言无进展。
      this.result = result.isError
        ? { key: '', count: 0 }
        : bump(this.result, `${actionKey}\0${outcome}`);
      this.poll = { key: '', count: 0 };
    }
    this.error = result.isError
      ? bump(this.error, `${toolName}\0${errorFamily(result.text)}`)
      : { key: '', count: 0 };

    const hit: RunawaySignal | undefined =
      this.result.count >= THRESHOLD
        ? 'unchanged_progress_repeat'
        : this.error.count >= THRESHOLD
          ? 'same_error_family'
          : this.action.count >= THRESHOLD
            ? 'exact_action_repeat'
            : this.poll.count >= THRESHOLD
              ? 'polling_repeat'
              : undefined;
    if (!hit) return undefined;
    this.reminded = true;
    return runawayReminderText(hit);
  }
}

export function withRunawayGuard(definition: ToolDefinition, guard: RunawayGuard): ToolDefinition {
  return {
    ...definition,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const result = await definition.execute(toolCallId, params, signal, onUpdate, ctx);
      const reminder = guard.observe(definition.name, params, {
        text: toolResultText(result),
        isError: toolResultIsError(result),
      });
      return reminder ? prependToolText(result, reminder) : result;
    },
  };
}
