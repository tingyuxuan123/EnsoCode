/** Renderer 只传群 / 任务标识；Main 根据权威目录校验归属。 */
export type TaskBoardNavigation =
  | { kind: 'group'; chatId: string }
  | { kind: 'task'; chatId: string; taskId: string };

export type TaskBoardWindowResult = { ok: true } | { ok: false; error: string };
