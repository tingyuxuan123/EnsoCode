import type {
  BotId,
  BotRoutine,
  Delegation,
  GroupTask,
  GroupTaskRun,
  GroupTaskStatus,
} from '@shared/types/bot';
import { GROUP_TASK_BLOCKED_STREAK_MAX, stalledTaskRun, taskBlock } from '@shared/types/bot';
import { isActiveDelegation } from './delegations';

/** 看板分栏：待办 / 进行中 / 待验收按编号，已完成 / 已取消新的在前 */
export function taskColumns(tasks: readonly GroupTask[]): Record<GroupTaskStatus, GroupTask[]> {
  const columns: Record<GroupTaskStatus, GroupTask[]> = {
    todo: [],
    doing: [],
    review: [],
    done: [],
    canceled: [],
    blocked: [],
  };
  for (const task of tasks) {
    // 旧数据里的失败委派仍是 doing，展示时与新的受阻任务放在一起。
    const status = task.status === 'doing' && stalledTaskRun(task) ? 'blocked' : task.status;
    columns[status].push(task);
  }
  columns.todo.sort((a, b) => a.seq - b.seq);
  columns.doing.sort((a, b) => a.seq - b.seq);
  columns.blocked.sort((a, b) => a.seq - b.seq);
  columns.review.sort((a, b) => a.seq - b.seq);
  columns.done.sort((a, b) => b.updatedAt - a.updatedAt);
  columns.canceled.sort((a, b) => b.updatedAt - a.updatedAt);
  return columns;
}

/** 退回返工：委派交付、仍有执行人的待验收任务，原执行人在原会话接着改 */
export function canRework(task: GroupTask): boolean {
  return task.status === 'review' && Boolean(task.delegationId && task.assigneeBotId);
}

/** 本群的例行任务（跨成员） */
export function chatRoutines(routines: readonly BotRoutine[], chatId: string): BotRoutine[] {
  return routines
    .filter((routine) => routine.chatId === chatId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

const finished = (item: Delegation) => item.finishedAt ?? item.createdAt;

/** 本群委派汇总：进行中（先发起的在前）/ 已完成 / 失败·中断·取消（新的在前） */
export function chatDelegationGroups(
  delegations: readonly Delegation[],
  chatId: string
): { active: Delegation[]; completed: Delegation[]; failed: Delegation[] } {
  const mine = delegations.filter((item) => item.chatId === chatId);
  return {
    active: mine
      .filter((item) => isActiveDelegation(item.state))
      .sort((a, b) => a.createdAt - b.createdAt),
    completed: mine
      .filter((item) => item.state === 'completed')
      .sort((a, b) => finished(b) - finished(a)),
    failed: mine
      .filter((item) => ['failed', 'canceled', 'blocked'].includes(item.state))
      .sort((a, b) => finished(b) - finished(a)),
  };
}

export interface TaskRunRow {
  run: GroupTaskRun;
  /** 对应委派记录（查看过程要它的子会话）；记录已清理时缺省 */
  record?: Delegation;
  /** queued：排队中，ms 为已等待时长；否则 ms 为执行耗时 */
  time: { queued: boolean; ms: number };
}

/** 任务卡「历次执行」：按发起先后；排队中按 createdAt 记等待，其余按 startedAt→finishedAt 记耗时 */
export function taskRunRows(
  runs: readonly GroupTaskRun[],
  delegations: readonly Delegation[],
  now: number
): TaskRunRow[] {
  const records = new Map(delegations.map((item) => [item.id, item]));
  return [...runs]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((run) => ({
      run,
      record: records.get(run.id),
      time:
        run.state === 'queued' && run.startedAt === undefined
          ? { queued: true, ms: now - run.createdAt }
          : { queued: false, ms: (run.finishedAt ?? now) - (run.startedAt ?? run.createdAt) },
    }));
}

export type TaskBlockInfo =
  | {
      reason: 'need';
      need: string;
      /** 等谁回复：human = 你，否则为发起方成员 */
      waitFor: 'human' | BotId;
      /** 连续缺信息卡满次数，只接受人来解除 */
      humanOnly?: true;
      since: number;
    }
  | { reason: 'failed'; record?: Delegation; since: number };

/** 卡住的任务：缺什么 / 失败原因、等谁、从何时起卡住；没卡住返回 undefined */
export function taskBlockInfo(
  task: GroupTask,
  delegations: readonly Delegation[]
): TaskBlockInfo | undefined {
  const block = taskBlock(task);
  if (!block) return undefined;
  const record = delegations.find((item) => item.id === task.delegationId);
  if (block.reason === 'failed') {
    const run = stalledTaskRun(task);
    return {
      reason: 'failed',
      ...(record ? { record } : {}),
      since: run?.finishedAt ?? record?.finishedAt ?? task.updatedAt,
    };
  }
  const humanOnly =
    (task.blockedStreak?.[task.assigneeBotId ?? ''] ?? 0) >= GROUP_TASK_BLOCKED_STREAK_MAX;
  return {
    reason: 'need',
    need: block.need || record?.blocked?.need || '',
    waitFor: !humanOnly && record?.blocked?.waitFor === 'parent' ? record.parentBotId : 'human',
    ...(humanOnly ? { humanOnly: true as const } : {}),
    since: record?.finishedAt ?? record?.blocked?.at ?? task.updatedAt,
  };
}

/** 提醒用户验收、处理执行失败，或补充只有用户需要回复的信息。 */
export function taskNeedsAttention(task: GroupTask, delegations: readonly Delegation[]): boolean {
  if (task.status === 'review') return true;
  const block = taskBlockInfo(task, delegations);
  return block?.reason === 'failed' || (block?.reason === 'need' && block.waitFor === 'human');
}
