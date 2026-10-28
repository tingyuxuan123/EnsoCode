import { Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSubagentDirectory } from '@/hooks/useSubagentDirectory';
import { useI18n } from '@/i18n';
import { addSidePanelSubagent } from '@/lib/sidePanelDock';
import { type SubagentDirectoryEntry, selectSubagentDirectory } from '@/lib/subagentTargets';
import { useSessionsStore } from '@/stores/sessions';

export function SubagentDirectoryView({ parentConversationId }: { parentConversationId: string }) {
  const { t } = useI18n();
  const entries = useSubagentDirectory(parentConversationId);
  const parentExists = useSessionsStore((state) =>
    Boolean(state.conversations[parentConversationId])
  );
  const standingBy = (entry: SubagentDirectoryEntry) =>
    entry.mode === 'coworker' && !entry.closed && (entry.ended || entry.status === 'waiting');
  const hasEnded = (entry: SubagentDirectoryEntry) =>
    entry.closed || (entry.mode === 'task' && entry.ended);
  const statusLabel = (status: SubagentDirectoryEntry['status']) =>
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
  return (
    <div className="h-full overflow-y-auto bg-background p-3">
      <h2 className="text-sm font-medium">{t('Agents')}</h2>
      <p className="mt-1 text-[calc(11rem/14)] text-muted-foreground">
        {t('Recorded child sessions, not a complete run history.')}
      </p>
      {!parentExists || !entries.length ? (
        <div className="mt-4 rounded-md border border-dashed px-3 py-8 text-center">
          <Bot className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">
            {parentExists ? t('No subagents yet') : t('Parent conversation is unavailable.')}
          </p>
          <p className="mt-1 text-[calc(11rem/14)] text-muted-foreground">
            {t('Subagent sessions appear here when they are created.')}
          </p>
        </div>
      ) : (
        [
          { label: t('One-off task'), items: entries.filter((entry) => entry.mode === 'task') },
          {
            label: t('Persistent collaborator'),
            items: entries.filter((entry) => entry.mode === 'coworker'),
          },
        ].map(
          ({ label, items }) =>
            items.length > 0 && (
              <section key={label} className="mt-4">
                <h3 className="mb-1 px-2 text-[calc(11rem/14)] font-medium text-muted-foreground">
                  {label} · {items.length}
                </h3>
                {[
                  {
                    label: t('In progress'),
                    items: items.filter((entry) => !hasEnded(entry) && !standingBy(entry)),
                  },
                  { label: t('Collaborator standing by'), items: items.filter(standingBy) },
                  { label: t('Ended'), items: items.filter(hasEnded) },
                ].map(
                  ({ label: lifecycle, items: members }) =>
                    members.length > 0 && (
                      <div key={lifecycle} className="mt-2">
                        <h4 className="px-2 text-[calc(11rem/14)] text-muted-foreground">
                          {lifecycle} · {members.length}
                        </h4>
                        {members.map((entry) => (
                          <div
                            key={entry.childConversationId}
                            className="mt-1 rounded-md border px-2 py-2"
                          >
                            <div className="flex items-start gap-2">
                              <Bot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm" title={entry.title}>
                                  {entry.title}
                                </p>
                                <p className="text-[calc(11rem/14)] text-muted-foreground">
                                  {entry.origin === 'manual'
                                    ? t('Created manually')
                                    : entry.origin === 'agent-tool'
                                      ? t('Dispatched by agent')
                                      : t('Dispatched via mention')}
                                </p>
                                <p className="truncate text-[calc(11rem/14)] text-muted-foreground">
                                  {hasEnded(entry)
                                    ? t('Ended')
                                    : standingBy(entry)
                                      ? t('Collaborator standing by')
                                      : statusLabel(entry.status)}
                                  {entry.modelId ? ` · ${entry.modelId}` : ''}
                                </p>
                                {entry.ended && entry.status !== 'ended' && (
                                  <p className="text-[calc(11rem/14)] text-muted-foreground">
                                    {t('Last run: {{status}}', {
                                      status: statusLabel(entry.status),
                                    })}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-[calc(11rem/14)]"
                                onClick={() =>
                                  addSidePanelSubagent({
                                    parentConversationId,
                                    childConversationId: entry.childConversationId,
                                    title: entry.title,
                                  })
                                }
                              >
                                {t('View process')}
                              </Button>
                              {entry.canOpenConversation && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-[calc(11rem/14)]"
                                  onClick={() => {
                                    const state = useSessionsStore.getState();
                                    if (
                                      !selectSubagentDirectory(
                                        state.conversations,
                                        parentConversationId
                                      ).find(
                                        (item) =>
                                          item.childConversationId === entry.childConversationId
                                      )?.canOpenConversation
                                    )
                                      return;
                                    state.selectConversation(parentConversationId);
                                    useSessionsStore
                                      .getState()
                                      .selectTab(parentConversationId, entry.childConversationId);
                                  }}
                                >
                                  {t('Open conversation')}
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                )}
              </section>
            )
        )
      )}
    </div>
  );
}
