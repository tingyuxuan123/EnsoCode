import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/stores/sessions/stats';
import { Markdown } from './Markdown';
import type { SubagentReceiptView, SubagentRunLine } from './subagentReceipt';

/** run / 子代理状态 → [i18n key, 状态点颜色]；未知状态原样显示 */
const STATUS: Record<string, [label: string, dot: string]> = {
  queued: ['Queued', 'bg-muted-foreground'],
  running: ['running', 'bg-amber-500'],
  awaiting_input: ['awaiting input', 'bg-amber-500'],
  validating: ['validating', 'bg-amber-500'],
  succeeded: ['succeeded', 'bg-emerald-500'],
  failed: ['failed', 'bg-destructive'],
  cancelled: ['cancelled', 'bg-muted-foreground'],
  interrupted: ['interrupted', 'bg-muted-foreground'],
  creating: ['creating', 'bg-amber-500'],
  ready: ['idle', 'bg-muted-foreground'],
  active: ['running', 'bg-amber-500'],
  parked: ['parked', 'bg-muted-foreground'],
  closed: ['closed', 'bg-muted-foreground'],
};

/** 子代理 report / wait / list 结果：回答在前，各 run / 子代理状态一行一个，运行信息原文收起 */
export function SubagentResult({
  view,
  titles,
  onOpenAgent,
  openableAgentIds,
}: {
  view: SubagentReceiptView;
  /** agentId → spawn 时起的名字 */
  titles?: Record<string, string>;
  onOpenAgent?: (agentId: string) => void;
  openableAgentIds?: ReadonlySet<string>;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2 px-3 py-2 text-sm">
      {view.kind === 'report' && view.text && <Markdown text={view.text} />}
      {view.kind === 'report' && view.value && (
        <Markdown text={`\`\`\`json\n${view.value}\n\`\`\``} />
      )}
      {view.kind === 'report' && view.error && (
        <p className="whitespace-pre-wrap text-destructive">{view.error}</p>
      )}
      {view.runs.length > 0 && (
        <ul className="space-y-0.5 text-[calc(11rem/14)] text-muted-foreground">
          {view.runs.map((run) => (
            <RunLine
              key={run.runId || run.agentId}
              run={run}
              title={titles?.[run.agentId]}
              onOpen={
                onOpenAgent && openableAgentIds?.has(run.agentId)
                  ? () => onOpenAgent(run.agentId)
                  : undefined
              }
            />
          ))}
        </ul>
      )}
      {view.kind === 'list' && view.runs.length === 0 && (
        <p className="text-[calc(11rem/14)] text-muted-foreground">{t('No agents')}</p>
      )}
      {view.kind === 'wait' && view.timedOut && (
        <p className="text-[calc(11rem/14)] text-muted-foreground">
          {t('Timed out; unfinished agents keep running')}
        </p>
      )}
      {view.kind === 'wait' && view.interrupted && (
        <p className="text-[calc(11rem/14)] text-muted-foreground">{t('Wait was interrupted')}</p>
      )}
      <details className="text-[calc(11rem/14)] text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">{t('Run info')}</summary>
        <pre className="mt-1 whitespace-pre-wrap font-mono">{view.info}</pre>
      </details>
      {view.head && (
        <pre className="whitespace-pre-wrap font-mono text-[calc(11rem/14)] text-muted-foreground">
          {view.head}
        </pre>
      )}
    </div>
  );
}

function RunLine({
  run,
  title,
  onOpen,
}: {
  run: SubagentRunLine;
  title?: string;
  onOpen?: () => void;
}) {
  const { t } = useI18n();
  const [label, dot] = STATUS[run.status] ?? [null, 'bg-muted-foreground'];
  const took =
    run.durationMs === null
      ? ''
      : t('took {{duration}}', { duration: formatDuration(run.durationMs) });
  return (
    <li className="flex min-w-0 items-center gap-1.5">
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot)} />
      {title && <span className="truncate text-foreground">{title}</span>}
      <span className="shrink-0">
        {[label ? t(label) : run.status, took].filter(Boolean).join(' · ')}
      </span>
      {onOpen && (
        <button
          type="button"
          data-subagent-open={run.agentId}
          onClick={onOpen}
          className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {t('View process')}
        </button>
      )}
    </li>
  );
}
