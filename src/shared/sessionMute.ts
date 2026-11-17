/**
 * 会话静音（只屏蔽主动打扰：系统通知、配对推送、角标）。
 *
 * 根会话归属必须按权威记录判定：子会话 id 里的 `::` 前缀只是命名约定，
 * 谁都能造出 `victim::cw-x` 这样的字符串，不能拿它当父会话。
 * 有持久化记录时走 parentId 链；只有记录还没落盘时才退回结构化前缀。
 */

/** 结构化兜底：`root::cw-x` → root。只在持久化记录缺失时使用。 */
export function sessionMuteRootId(sessionId: string): string {
  const sep = sessionId.indexOf('::');
  return sep === -1 ? sessionId : sessionId.slice(0, sep);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function conversationsOf(settings: unknown): Record<string, unknown> | undefined {
  if (!settings || typeof settings !== 'object') return undefined;
  const store = (settings as Record<string, unknown>)['enso-conversations'];
  if (!isRecord(store)) return undefined;
  const state = store.state;
  if (!isRecord(state)) return undefined;
  return isRecord(state.conversations) ? state.conversations : undefined;
}

/** 权威父链接：普通子会话用 parentId，旁路会话用 btwParentId。 */
function parentIdOf(record: Record<string, unknown> | undefined): string | undefined {
  if (!isRecord(record)) return undefined;
  const parentId = typeof record.parentId === 'string' ? record.parentId : undefined;
  if (parentId) return parentId;
  return typeof record.btwParentId === 'string' && record.btwParentId
    ? record.btwParentId
    : undefined;
}

/** 沿持久化 parentId 回溯到根；起始记录不存在（还没落盘）时返回 undefined。 */
function walkParentChain(
  conversations: Record<string, unknown>,
  sessionId: string
): string | undefined {
  if (!isRecord(conversations[sessionId])) return undefined;
  let current = sessionId;
  const seen = new Set([current]);
  for (;;) {
    const parentId = parentIdOf(conversations[current] as Record<string, unknown> | undefined);
    if (!parentId || parentId === current) return current;
    // 坏记录环形：停在当前节点，不陪它转圈
    if (seen.has(parentId)) return current;
    seen.add(parentId);
    current = parentId;
  }
}

/** 静音归属的根会话 id：优先用持久化 parentId 链，记录缺失才退回 `::` 前缀。 */
export function sessionMuteRoot(settings: unknown, sessionId: string): string {
  const conversations = conversationsOf(settings);
  const walked = conversations ? walkParentChain(conversations, sessionId) : undefined;
  return walked ?? sessionMuteRootId(sessionId);
}

/**
 * 直接对会话表求根会话静音：`enso-conversations.state.conversations`,
 * 也可以传 renderer 内存里的 conversations（含尚未落盘的子会话/旁路）。
 * 子会话与旁路跟随根会话；拿不到会话表或脏输入一律按未静音。
 */
export function isSessionMutedInConversations(conversations: unknown, sessionId: string): boolean {
  if (!sessionId) return false;
  if (!isRecord(conversations)) return false;
  const root = walkParentChain(conversations, sessionId) ?? sessionMuteRootId(sessionId);
  const record = conversations[root];
  return isRecord(record) && record.muted === true;
}

/** 持久化的 enso-conversations 里，根会话 muted === true 才算静音。 */
export function isSessionMutedInStore(settings: unknown, sessionId: string): boolean {
  return isSessionMutedInConversations(conversationsOf(settings), sessionId);
}
