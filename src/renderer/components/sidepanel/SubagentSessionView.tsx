import { AlertCircle, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { ChatHostContext } from '@/components/chat/chatHost';
import { MarkdownLinkContext } from '@/components/chat/Markdown';
import { MessageTimeline } from '@/components/chat/MessageTimeline';
import { Button } from '@/components/ui/button';
import { useSubagentDirectory } from '@/hooks/useSubagentDirectory';
import { useI18n } from '@/i18n';
import { resolveSidePanelDockConversationId } from '@/lib/sidePanelDockId';
import { resolveSubagentTarget, selectSubagentDirectory } from '@/lib/subagentTargets';
import { type Conversation, useSessionsStore } from '@/stores/sessions';
import {
  buildTimeline,
  patchStreamingTimeline,
  type TimelineItem,
  terminalErrorText,
} from '@/stores/sessions/timeline';
import { useSettingsStore } from '@/stores/settings';

export function SubagentSessionView({
  parentConversationId,
  childConversationId,
  visible,
}: {
  parentConversationId: string;
  childConversationId: string;
  visible: boolean;
}) {
  const { t } = useI18n();
  const conversation = useSessionsStore((state) => state.conversations[childConversationId]);
  const target = useSessionsStore((state) => {
    const agentId = state.conversations[childConversationId]?.child?.agentInstanceId;
    return agentId
      ? resolveSubagentTarget(state.conversations, parentConversationId, agentId)
          ?.childConversationId
      : undefined;
  });
  const entry = useSubagentDirectory(parentConversationId).find(
    (item) => item.childConversationId === childConversationId
  );
  const parentWorktree = useSessionsStore((state) => {
    const ownerId = resolveSidePanelDockConversationId(state.conversations, parentConversationId);
    return (
      state.conversations[parentConversationId]?.worktree?.path ??
      state.conversations[ownerId]?.worktree?.path
    );
  });
  const fileLinksAvailable = useSessionsStore(
    (state) =>
      resolveSidePanelDockConversationId(state.conversations, childConversationId) !==
      childConversationId
  );
  const projectPath = useSettingsStore(
    (state) => state.projects.find((project) => project.id === conversation?.projectId)?.path
  );
  const valid = Boolean(conversation && target === childConversationId);
  useEffect(() => {
    if (!visible || !valid) return;
    return useSessionsStore.getState().acquireObservation(childConversationId);
  }, [childConversationId, valid, visible]);

  const cwd = conversation?.worktree?.path ?? parentWorktree ?? projectPath;
  const running = conversation?.status === 'running' && !entry?.closed;
  const cache = useRef<{ conversation?: Conversation; cwd?: string; items: TimelineItem[] }>({
    items: [],
  });
  const timeline = useMemo(() => {
    if (!valid || !conversation) return [];
    const base = conversation.historyBaseIndex ?? 0;
    const previous = cache.current.conversation;
    const canPatch =
      previous?.id === childConversationId &&
      previous.generation === conversation.generation &&
      previous.historyBaseIndex === conversation.historyBaseIndex &&
      cache.current.cwd === cwd &&
      previous.customEntries === conversation.customEntries &&
      previous.toolOutputs === conversation.toolOutputs &&
      previous.toolStartedAt === conversation.toolStartedAt &&
      previous.pendingApprovals === conversation.pendingApprovals &&
      previous.compaction === conversation.compaction &&
      previous.compactionNoticeAt === conversation.compactionNoticeAt &&
      previous.messages.length === conversation.messages.length &&
      conversation.messages.every(
        (message, index) =>
          index === conversation.messages.length - 1 || message === previous.messages[index]
      );
    const items =
      (canPatch
        ? patchStreamingTimeline(cache.current.items, conversation.messages, running, base)
        : null) ??
      buildTimeline(conversation.messages, running, conversation.customEntries, cwd, {
        compaction: conversation.compaction,
        compactionNoticeAt: conversation.compactionNoticeAt,
        historyBaseIndex: base,
        toolOutputs: conversation.toolOutputs,
        toolStartedAt: conversation.toolStartedAt,
        pendingApprovals: conversation.pendingApprovals,
      });
    cache.current = { conversation, cwd, items };
    return items;
  }, [childConversationId, conversation, cwd, running, valid]);
  const host = useMemo(
    () => ({
      sessionId: childConversationId,
      canRetry: false,
      canRewind: false,
      canFork: false,
    }),
    [childConversationId]
  );
  const projectId = conversation?.projectId;
  const linkContext = useMemo(
    () =>
      projectId && fileLinksAvailable
        ? {
            conversationId: childConversationId,
            projectId,
            ...(cwd ? { cwd } : {}),
          }
        : null,
    [childConversationId, projectId, cwd, fileLinksAvailable]
  );

  if (!valid || !conversation) {
    return (
      <div className="p-4 text-sm text-muted-foreground" role="status">
        {t('Subagent session is unavailable.')}
      </div>
    );
  }
  const loading = Boolean(
    conversation.reloading ||
      conversation.historyLoading ||
      (!conversation.historyLoadAttempted &&
        !conversation.messages.length &&
        !conversation.historyError)
  );
  const missingHistory =
    conversation.ended && !conversation.sessionFile && !conversation.messages.length;
  const historyError =
    conversation.historyError ||
    (missingHistory ? t('Recorded history is unavailable for this ended subagent.') : undefined);
  const status = entry?.status;
  const statusText =
    status === 'starting'
      ? t('Starting')
      : status === 'running'
        ? t('Running')
        : status === 'failed'
          ? t('Failed')
          : status === 'ended'
            ? t('Ended')
            : status === 'succeeded'
              ? t('Succeeded')
              : status === 'cancelled'
                ? t('Cancelled')
                : status === 'interrupted'
                  ? t('Interrupted')
                  : status === 'queued'
                    ? t('Queued')
                    : status === 'awaiting_input'
                      ? t('Awaiting input')
                      : status === 'validating'
                        ? t('Validating')
                        : t('Waiting');
  const lifecycleText = entry?.closed
    ? t('Ended')
    : entry?.mode === 'coworker' && (entry.ended || status === 'waiting')
      ? t('Collaborator standing by')
      : entry?.ended
        ? t('Ended')
        : statusText;

  return (
    <ChatHostContext.Provider value={host}>
      <MarkdownLinkContext.Provider value={linkContext}>
        <div className="flex h-full min-h-0 flex-col bg-background">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={entry?.title}>
                {entry?.title}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {t('Read-only')} · {lifecycleText}
                {entry?.modelId ? ` · ${entry.modelId}` : ''}
              </p>
              {entry?.ended && status !== 'ended' && (
                <p className="text-xs text-muted-foreground">
                  {t('Last run: {{status}}', { status: statusText })}
                </p>
              )}
            </div>
            {entry?.canOpenConversation && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  const state = useSessionsStore.getState();
                  if (
                    !selectSubagentDirectory(state.conversations, parentConversationId).find(
                      (item) => item.childConversationId === childConversationId
                    )?.canOpenConversation
                  )
                    return;
                  state.selectConversation(parentConversationId);
                  useSessionsStore.getState().selectTab(parentConversationId, childConversationId);
                }}
              >
                {t('Open conversation')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              title={t('Reload recorded history')}
              aria-label={t('Reload recorded history')}
              disabled={Boolean(conversation.reloading || conversation.historyLoading)}
              onClick={() =>
                void useSessionsStore.getState().reloadConversation(childConversationId)
              }
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">
            {t('Process observation only. Messages cannot be sent here.')}{' '}
            {t('Closing this view does not stop the agent.')}
          </p>
          {historyError && (
            <div
              role="alert"
              className="flex shrink-0 items-start gap-2 border-b px-3 py-2 text-xs text-destructive"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">{t(historyError)}</span>
            </div>
          )}
          {conversation.historyPartial && (
            <p role="status" className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">
              {t('Only recorded history is shown. Some earlier content may be unavailable.')}
            </p>
          )}
          {!fileLinksAvailable && (
            <p role="status" className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">
              {t('File links are unavailable for this workspace.')}
            </p>
          )}
          <div className="flex min-h-0 flex-1 flex-col @container">
            <MessageTimeline
              key={childConversationId}
              items={timeline}
              running={running}
              busy={running || (loading && !historyError)}
              loading={loading && !historyError}
              runStartedAt={conversation.runStartedAt}
              lastOutputAt={conversation.lastOutputAt}
              error={
                !running && !conversation.spawning && entry?.ended
                  ? terminalErrorText(
                      conversation.messages,
                      conversation.lastSubagentRun?.error ?? conversation.error
                    )
                  : undefined
              }
              emptyTitle={t('No recorded output yet')}
              emptyDescription=""
              historyLoading={Boolean(conversation.historyLoading)}
              hasOlder={(conversation.historyBaseIndex ?? 0) > 0}
              olderCursor={conversation.historyBaseIndex ?? 0}
              onStartReached={
                visible && (conversation.historyBaseIndex ?? 0) > 0
                  ? () => void useSessionsStore.getState().loadOlderHistory(childConversationId)
                  : undefined
              }
            />
          </div>
        </div>
      </MarkdownLinkContext.Provider>
    </ChatHostContext.Provider>
  );
}
