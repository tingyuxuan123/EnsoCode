/** 底部状态栏只需要这些会话字段；与 sessions store 的会话形状结构兼容 */
export interface StatusBarConversation {
  status?: string;
  spawning?: boolean;
  archived?: boolean;
  btwParentId?: string;
  pendingApprovals?: readonly unknown[];
  pendingAsks?: readonly unknown[];
  pendingCapabilityAsks?: readonly unknown[];
}

export interface WorkbenchSummary {
  /** 正在运行（或启动中）且不在等用户的会话数 */
  running: number;
  /** 有审批、提问或能力授权等待用户处理的会话数 */
  waiting: number;
}

const hasItems = (list?: readonly unknown[]) => Boolean(list && list.length > 0);

/** 工作台摘要：跳过已归档与 btw 旁路会话；等用户的会话不重复计入运行中 */
export function summarizeWorkbench(
  conversations: Record<string, StatusBarConversation | undefined>
): WorkbenchSummary {
  let running = 0;
  let waiting = 0;
  for (const conversation of Object.values(conversations)) {
    if (!conversation || conversation.archived || conversation.btwParentId) continue;
    if (
      hasItems(conversation.pendingApprovals) ||
      hasItems(conversation.pendingAsks) ||
      hasItems(conversation.pendingCapabilityAsks)
    ) {
      waiting += 1;
    } else if (conversation.status === 'running' || conversation.spawning) {
      running += 1;
    }
  }
  return { running, waiting };
}
