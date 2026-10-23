import { Bot, ChevronRight } from 'lucide-react';
import { useSubagentDirectory } from '@/hooks/useSubagentDirectory';
import { useI18n } from '@/i18n';
import { addSidePanelSubagent, addSidePanelSubagentDirectory } from '@/lib/sidePanelDock';
import { resolveSubagentTarget } from '@/lib/subagentTargets';
import { useSessionsStore } from '@/stores/sessions';

/** 入口基于持久 child metadata，不依赖五秒后消失的 TaskBar 活动预览。 */
export function SubagentProcessBar({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const entries = useSubagentDirectory(sessionId);
  if (!entries?.length) return null;
  const running = entries.filter(
    (entry) => !entry.closed && !entry.ended && entry.status !== 'waiting'
  );
  return (
    <div className="mb-1.5 rounded-xl border bg-card p-1 text-xs" data-subagent-process-bar="">
      <button
        type="button"
        onClick={() => addSidePanelSubagentDirectory(sessionId)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Bot className="size-3.5" />
        <span>{t('Agents')}</span>
        <span className="ml-auto tabular-nums">
          {running.length > 0 ? t('{{count}} running', { count: running.length }) : entries.length}
        </span>
        <ChevronRight className="size-3.5" />
      </button>
      {running.map((entry) => (
        <button
          key={entry.childConversationId}
          type="button"
          data-subagent-open={entry.agentId}
          onClick={() => {
            const target = resolveSubagentTarget(
              useSessionsStore.getState().conversations,
              sessionId,
              entry.agentId
            );
            if (target) addSidePanelSubagent(target);
          }}
          className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
          <span className="min-w-0 flex-1 truncate">
            {entry.title}
            <span className="ml-1 text-muted-foreground">
              · {entry.mode === 'task' ? t('One-off task') : t('Persistent collaborator')}
            </span>
          </span>
          <span className="shrink-0 text-muted-foreground">{t('View process')}</span>
        </button>
      ))}
    </div>
  );
}
