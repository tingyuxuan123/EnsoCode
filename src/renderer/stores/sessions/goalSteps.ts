import type { SessionGoal } from '@/stores/sessions';
import type { TimelineMessage } from './reducer';

export const GOAL_AUTO_TURN_LIMIT = 25;

export interface GoalStep {
  index: number;
  kind: 'start' | 'resume' | 'auto';
  number?: number;
  timestamp?: number;
  output: string;
  tools: { id: string; name: string; arguments: string }[];
  status: 'running' | 'ended' | 'failed' | 'pending';
}

/** 只从已加载的会话正文投影实际轮次，不生成未来步骤，也不持久化第二份日志。 */
export function goalSteps(
  messages: readonly TimelineMessage[],
  goal: Pick<SessionGoal, 'text' | 'autoTurns' | 'createdAt'>,
  status: string,
  baseIndex = 0
): GoalStep[] {
  const steps: GoalStep[] = [];
  let current: GoalStep | undefined;
  let autoNumber = 0;
  let lastGroupStart = 0;
  for (const [index, message] of messages.entries()) {
    if (message.role === 'user') {
      current = undefined;
      if (message.deliveryRejected) continue;
      if (goal.createdAt && message.timestamp !== undefined && message.timestamp < goal.createdAt)
        continue;
      const text = message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
      const kind = goalPromptKind(text, goal.text);
      if (!kind) continue;
      if (kind === 'start') steps.length = 0;
      if (kind !== 'auto') {
        autoNumber = 0;
        lastGroupStart = steps.length;
      }
      current = {
        index: baseIndex + index,
        kind,
        ...(kind === 'auto' ? { number: ++autoNumber } : {}),
        timestamp: message.timestamp,
        output: '',
        tools: [],
        status: message.optimistic ? 'pending' : 'ended',
      };
      steps.push(current);
      continue;
    }
    if (!current) continue;
    if (message.role === 'assistant') {
      const text = message.content
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('\n')
        .trim();
      if (text) current.output = text;
      for (const part of message.content) {
        if (part.type === 'toolCall') {
          current.tools.push({
            id: part.id,
            name: part.name,
            arguments: JSON.stringify(part.arguments) ?? '',
          });
        }
      }
    }
  }
  // 尾窗可能从第 N 轮才开始；只校准当前恢复批次，不把缺失历史伪造成空步骤。
  const offset = Math.max(0, goal.autoTurns - autoNumber);
  for (const step of steps.slice(lastGroupStart)) {
    if (step.number !== undefined) step.number += offset;
  }
  if (current && current.status !== 'pending') {
    current.status = status === 'running' ? 'running' : status === 'failed' ? 'failed' : 'ended';
  }
  return steps;
}

function goalPromptKind(text: string, objective: string): GoalStep['kind'] | null {
  for (const resumed of [false, true]) {
    const prefix = `<goal-continuation>\nSession goal${resumed ? ' resumed' : ''}: ${objective}\n`;
    const start = text.indexOf(prefix);
    if (start < 0) continue;
    const instruction = text.slice(start + prefix.length);
    if (!instruction.includes('</goal-continuation>')) continue;
    if (resumed && instruction.startsWith('Continue working toward it')) return 'resume';
    if (!resumed && instruction.startsWith('Work toward this goal autonomously.')) return 'start';
    if (!resumed && instruction.startsWith('Continue working toward it.')) return 'auto';
  }
  return null;
}
