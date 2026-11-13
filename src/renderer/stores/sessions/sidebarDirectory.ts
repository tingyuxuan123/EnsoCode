import { conversationHasRunningChild } from '@shared/conversationDotTone';
import { canSelectCoworkerTab } from './coworkerTabPolicy';

export type SidebarView = 'projects' | 'conversations';

export function newSidebarConversationProjectId(
  projects: readonly { id: string; kind?: string }[],
  activeProjectId: string | undefined,
  view: SidebarView
): string | undefined {
  if (view === 'conversations') return projects.find((project) => project.kind === 'scratch')?.id;
  const regular = projects.filter((project) => project.kind !== 'scratch');
  return regular.find((project) => project.id === activeProjectId)?.id ?? regular[0]?.id;
}

/** 先按项目 / 临时对话收窄目录，活跃、置顶、归档与快捷键沿用同一范围。 */
export function sidebarViewOrder(
  order: readonly string[],
  conversations: Record<string, { projectId: string } | undefined>,
  projects: readonly { id: string; kind?: string }[],
  view: SidebarView
): string[] {
  const scratchIds = new Set(
    projects.filter((project) => project.kind === 'scratch').map((project) => project.id)
  );
  return order.filter((id) => {
    const conversation = conversations[id];
    return (
      conversation !== undefined &&
      scratchIds.has(conversation.projectId) === (view === 'conversations')
    );
  });
}

export interface SidebarDirectoryEntry {
  id: string;
  title: string;
  status: string;
  spawning: boolean;
  /** 子会话 / subagent 仍在跑：侧栏蓝点，即使本会话 idle */
  hasRunningChild?: boolean;
  pinned?: boolean;
  archived?: boolean;
  archivedAt?: number;
  createdAt: number;
  projectId: string;
  lastActiveAt?: number;
  messages: { timestamp?: number }[];
  forkedFromConversationId?: string;
  unread?: boolean;
  pendingAsks?: readonly { requestId: string }[];
  pendingApprovals?: readonly unknown[];
  pendingCapabilityAsks?: readonly unknown[];
  coworkerIds?: readonly string[];
  coworkerName?: string;
  child?: { agentInstanceName?: string };
  subagents?: readonly { status: string }[];
  parentId?: string;
  sessionFile?: string;
  worktree?: { path?: string };
}

type Source = {
  id?: string;
  title: string;
  status?: string;
  spawning?: boolean;
  pinned?: boolean;
  archived?: boolean;
  archivedAt?: number;
  createdAt: number;
  projectId: string;
  lastActiveAt?: number;
  messages: { timestamp?: number }[];
  forkedFromConversationId?: string;
  unread?: boolean;
  pendingAsks?: readonly { requestId: string }[];
  pendingApprovals?: readonly unknown[];
  pendingCapabilityAsks?: readonly unknown[];
  coworkerIds?: readonly string[];
  coworkerName?: string;
  child?: {
    agentInstanceName?: string;
    agentInstanceId?: string;
    agentTypeKey?: string;
    mode?: 'task' | 'coworker';
  };
  subagents?: readonly { status: string }[];
  parentId?: string;
  sessionFile?: string;
  worktree?: { path?: string };
  reloading?: boolean;
  btwParentId?: string;
  hiddenCoworkerIds?: readonly string[];
  ended?: boolean;
  historyOnly?: boolean;
  superAssistant?: boolean;
};

function lastActiveAt(conversation: Source): number | undefined {
  return conversation.messages.at(-1)?.timestamp ?? conversation.lastActiveAt;
}

function project(conversation: Source, hasRunningChild: boolean): SidebarDirectoryEntry {
  return {
    id: conversation.id ?? '',
    title: conversation.title,
    status: conversation.status ?? 'idle',
    spawning: conversation.spawning === true,
    hasRunningChild,
    pinned: conversation.pinned,
    archived: conversation.archived,
    archivedAt: conversation.archivedAt,
    createdAt: conversation.createdAt,
    projectId: conversation.projectId,
    lastActiveAt: lastActiveAt(conversation),
    messages: [],
    forkedFromConversationId: conversation.forkedFromConversationId,
    unread: conversation.unread,
    pendingAsks: conversation.pendingAsks,
    pendingApprovals: conversation.pendingApprovals,
    pendingCapabilityAsks: conversation.pendingCapabilityAsks,
    coworkerIds: conversation.coworkerIds,
    coworkerName: conversation.coworkerName,
    child: conversation.child,
    subagents: conversation.subagents,
    parentId: conversation.parentId,
    sessionFile: conversation.sessionFile,
    worktree: conversation.worktree,
  };
}

function fingerprint(entry: SidebarDirectoryEntry): string {
  return JSON.stringify(entry);
}

let cached: {
  source: Record<string, Source | undefined>;
  prints: string[];
  value: Record<string, SidebarDirectoryEntry>;
} | null = null;

export function selectSidebarConversations(
  conversations: Record<string, Source | undefined>
): Record<string, SidebarDirectoryEntry> {
  if (cached?.source === conversations) return cached.value;
  const next: Record<string, SidebarDirectoryEntry> = {};
  const prints: string[] = [];
  for (const [id, conversation] of Object.entries(conversations)) {
    if (!conversation) continue;
    if (conversation.btwParentId || conversation.superAssistant) continue;
    const entry = project(
      conversation,
      conversationHasRunningChild(
        {
          status: conversation.status ?? 'idle',
          spawning: conversation.spawning,
          subagents: conversation.subagents,
          coworkerIds: conversation.coworkerIds,
        },
        conversations
      )
    );
    next[id] = entry;
    prints.push(`${id}:${fingerprint(entry)}`);
  }
  if (
    cached &&
    cached.prints.length === prints.length &&
    cached.prints.every((item, i) => item === prints[i])
  ) {
    cached = { source: conversations, prints, value: cached.value };
    return cached.value;
  }
  cached = { source: conversations, prints, value: next };
  return next;
}

export interface ChatCandidateConversation {
  id: string;
  title: string;
  projectId: string;
  parentId?: string;
  sessionFile?: string;
  createdAt: number;
}

let cachedChatCandidates: {
  source: Record<string, Source | undefined>;
  print: string;
  value: ChatCandidateConversation[];
} | null = null;

/** 只投影 @chat 候选实际使用的字段，流式正文和状态变化时保持引用稳定。 */
export function selectChatCandidateConversations(
  conversations: Record<string, Source | undefined>
): ChatCandidateConversation[] {
  if (cachedChatCandidates?.source === conversations) return cachedChatCandidates.value;
  const next: ChatCandidateConversation[] = [];
  for (const [id, conversation] of Object.entries(conversations)) {
    if (
      !conversation ||
      conversation.parentId ||
      conversation.btwParentId ||
      conversation.superAssistant ||
      !conversation.sessionFile
    )
      continue;
    next.push({
      id: conversation.id ?? id,
      title: conversation.title,
      projectId: conversation.projectId,
      sessionFile: conversation.sessionFile,
      createdAt: conversation.createdAt,
    });
  }
  const print = JSON.stringify(next);
  const value = cachedChatCandidates?.print === print ? cachedChatCandidates.value : next;
  cachedChatCandidates = { source: conversations, print, value };
  return value;
}

export interface CoworkerTabConversation {
  id: string;
  title: string;
  status: string;
  spawning: boolean;
  pendingApprovalCount: number;
  pendingAskCount: number;
  pendingCapabilityAskCount: number;
  coworkerName?: string;
  child?: { agentInstanceName?: string; agentTypeKey?: string };
  mode: 'task' | 'coworker';
  reloading: boolean;
  canObserve: boolean;
}

interface CoworkerTabsCache {
  source: Record<string, Source | undefined>;
  print: string;
  value: CoworkerTabConversation[];
}

const EMPTY_COWORKER_TABS: CoworkerTabConversation[] = [];
const cachedCoworkerTabs = new WeakMap<Source, CoworkerTabsCache>();
const cachedAllCoworkerTabs = new WeakMap<Source, CoworkerTabsCache>();

/** 当前 tab 条的窄投影，避免其它会话事件触发 CoworkerTabs 重渲染。 */
export function selectCoworkerTabConversations(
  conversations: Record<string, Source | undefined>,
  parentId: string,
  includeHidden = false
): CoworkerTabConversation[] {
  const parent = conversations[parentId];
  if (!parent) return EMPTY_COWORKER_TABS;
  const cache = includeHidden ? cachedAllCoworkerTabs : cachedCoworkerTabs;
  const cached = cache.get(parent);
  if (cached?.source === conversations) return cached.value;
  const next = (parent.coworkerIds ?? []).flatMap((id): CoworkerTabConversation[] => {
    const conversation = conversations[id];
    return conversation &&
      canSelectCoworkerTab(conversations, parentId, id) &&
      (includeHidden || !(parent.hiddenCoworkerIds ?? []).includes(id))
      ? [
          {
            id: conversation.id ?? id,
            title: conversation.title,
            status: conversation.status ?? 'idle',
            spawning: conversation.spawning === true,
            pendingApprovalCount: conversation.pendingApprovals?.length ?? 0,
            pendingAskCount: conversation.pendingAsks?.length ?? 0,
            pendingCapabilityAskCount: conversation.pendingCapabilityAsks?.length ?? 0,
            coworkerName: conversation.coworkerName,
            child: conversation.child?.agentInstanceName
              ? {
                  agentInstanceName: conversation.child.agentInstanceName,
                  agentTypeKey: conversation.child.agentTypeKey,
                }
              : undefined,
            mode: conversation.child?.mode === 'task' ? 'task' : 'coworker',
            reloading: conversation.reloading === true,
            canObserve: Boolean(conversation.child?.agentInstanceId),
          },
        ]
      : [];
  });
  const print = JSON.stringify(next);
  const value = cached?.print === print ? cached.value : next;
  cache.set(parent, { source: conversations, print, value });
  return value;
}
