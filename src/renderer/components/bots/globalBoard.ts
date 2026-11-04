import type { BotChat, Delegation, GroupTask } from '@shared/types/bot';
import { taskColumns, taskNeedsAttention } from '@/stores/bots/groupBoard';

export function rootBoardGroups(chats: readonly BotChat[]): BotChat[] {
  return chats.filter(
    (chat) => chat.kind === 'group' && chat.parentId === undefined && chat.archivedAt === undefined
  );
}

export interface GlobalTaskRow {
  group: BotChat;
  task: GroupTask;
  needsAttention: boolean;
}

type BoardStatus = 'todo' | 'doing' | 'blocked' | 'review' | 'done';

export function globalBoard(
  chats: readonly BotChat[],
  tasks: Record<string, GroupTask[]>,
  delegations: readonly Delegation[]
) {
  const rows = new Map<GroupTask, GlobalTaskRow>();
  const seen = new Map<string, Set<string>>();
  let attention = 0;
  for (const group of rootBoardGroups(chats)) {
    const ids = seen.get(group.id) ?? new Set<string>();
    seen.set(group.id, ids);
    for (const task of tasks[group.id] ?? []) {
      if (task.status === 'canceled' || ids.has(task.id)) continue;
      ids.add(task.id);
      const needsAttention = taskNeedsAttention(task, delegations);
      if (needsAttention) attention++;
      // Sorting returns task references; a fresh key also distinguishes shared objects across groups.
      rows.set({ ...task }, { group, task, needsAttention });
    }
  }
  const sorted = taskColumns([...rows.keys()]);
  const column = (status: BoardStatus) => sorted[status].flatMap((task) => rows.get(task) ?? []);
  return {
    columns: {
      todo: column('todo'),
      doing: column('doing'),
      blocked: column('blocked'),
      review: column('review'),
      done: column('done'),
    },
    total: rows.size,
    attention,
  };
}
