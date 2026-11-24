import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { normalizeTaskCheck } from '@shared/bots/taskCheck';
import { CHECK_SCHEMA } from './delegation';
import type { DelegationInvoker } from './delegationInvoker';

const ACTIONS = [
  'list',
  'add',
  'claim',
  'update',
  'complete',
  'cancel',
  'accept',
  'reject',
] as const;
const ALIASES: Record<string, (typeof ACTIONS)[number]> = {
  create: 'add',
  new: 'add',
  take: 'claim',
  edit: 'update',
  done: 'complete',
  finish: 'complete',
  approve: 'accept',
  return: 'reject',
};

/** schema 校验前归一化：action 别名 / 大小写，id 数字与别名键，可选键的 null */
export function normalizeGroupTaskParams(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const params = { ...raw } as Record<string, unknown>;
  for (const alias of ['taskId', 'task_id']) {
    if (params.id === undefined || params.id === null) params.id = params[alias];
    delete params[alias];
  }
  for (const key of ['id', 'title', 'detail', 'result', 'reason', 'rework']) {
    if (params[key] === null || params[key] === undefined) delete params[key];
  }
  if (typeof params.rework === 'string') {
    const flag = params.rework.trim().toLowerCase();
    if (flag === 'true' || flag === 'false') params.rework = flag === 'true';
  } else if (params.rework === 1 || params.rework === 0) params.rework = params.rework === 1;
  if ('check' in params) {
    params.check = normalizeTaskCheck(params.check);
    if (params.check === undefined) delete params.check;
  }
  if (typeof params.id === 'number') params.id = String(params.id);
  if (typeof params.action === 'string') {
    const action = params.action.trim().toLowerCase();
    params.action = ALIASES[action] ?? action;
  }
  return params;
}

export function createGroupTasksTool(invoker: DelegationInvoker): ToolDefinition {
  return {
    name: 'group_tasks',
    label: 'group_tasks',
    description:
      "Shared task board of this group chat. list: open tasks (#N, status, assignee, check, returnReason, blockedReason). add: create a task (title, optional detail, optional check) - only for real multi-step work, not every message. claim: take a todo task (id) before working on it; fails if someone already claimed it. update: edit title/detail (check only by its creator). complete: finish a task you claimed, with result (what was done); if the task has a check, complete is rejected unless one of your final tool outputs since claiming contains check.text. cancel: drop a task you created or own. A task delegated to someone other than its creator goes to status review when the delegation succeeds; only its creator or a human reviews it, never the assignee: accept (id) marks it done after you checked the result; reject (id, reason) sends it back to todo with the reason, then re-delegate or reassign; reject with rework: true instead has the same assignee redo it in the same session with your reason, and it comes back to review when delivered. A delegated task whose assignee cannot go on has status blocked with its assignee kept: blockedReason need (shows need; answer by delegating it to the same assignee again, or ask the human) or failed (shows failure; re-delegate it to retry or hand it to someone else). Ids look like '#3'.",
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...ACTIONS] },
        id: { type: 'string', minLength: 1, description: "Task id such as '#3'" },
        title: { type: 'string', minLength: 1, maxLength: 200 },
        detail: { type: 'string' },
        result: { type: 'string', description: 'Completion summary (required for complete)' },
        reason: { type: 'string', description: 'Why the result is rejected (required for reject)' },
        rework: {
          type: 'boolean',
          description: 'reject only: the same assignee redoes it in the same session',
        },
        check: CHECK_SCHEMA,
      },
      required: ['action'],
      additionalProperties: false,
    } as unknown as ToolDefinition['parameters'],
    prepareArguments: normalizeGroupTaskParams as ToolDefinition['prepareArguments'],
    async execute(_id, params, signal) {
      try {
        const result = await invoker.invoke(
          'group_tasks',
          normalizeGroupTaskParams(params),
          signal
        );
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: undefined };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          details: undefined,
          isError: true,
        };
      }
    },
  };
}
