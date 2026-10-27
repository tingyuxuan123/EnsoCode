import { CircleCheck, Laptop, LoaderCircle, Monitor, ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useRemoteNodesStore } from '@/stores/remoteNodes';
import { useSessionsStore } from '@/stores/sessions';
import { summarizeWorkbench } from './statusBarSummary';

/**
 * 窗口底部 28px 状态栏：当前节点、运行中/待处理会话数。只读摘要，不承载操作，
 * 状态全部来自现有 store，不新增数据源。
 */
export function StatusBar() {
  const { t } = useI18n();
  const nodes = useRemoteNodesStore((s) => s.nodes);
  const activeNodeId = useRemoteNodesStore((s) => s.activeNodeId);
  const conversations = useSessionsStore((s) => s.conversations);
  const summary = useMemo(() => summarizeWorkbench(conversations), [conversations]);

  const remote = activeNodeId === 'local' ? null : nodes.find((n) => n.nodeId === activeNodeId);
  const NodeIcon = remote ? Monitor : Laptop;
  const nodeTone = remote
    ? remote.hostOnline
      ? 'bg-success'
      : remote.connected
        ? 'bg-warning'
        : 'bg-muted-foreground/50'
    : 'bg-success';

  return (
    <footer
      data-slot="status-bar"
      className="flex h-7 shrink-0 items-center gap-4 border-t bg-shell px-3 text-[11px] text-muted-foreground"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={cn('size-1.5 shrink-0 rounded-full', nodeTone)} aria-hidden />
        <NodeIcon className="size-3.5 shrink-0" />
        <span className="truncate">{remote ? remote.label : t('This computer')}</span>
      </span>
      <span className="ml-auto flex items-center gap-4">
        {/* 本机会话摘要；远程节点下本机会话仍在后台运行，照常显示 */}
        {summary.waiting > 0 && (
          <span className="flex items-center gap-1.5 text-warning">
            <ShieldCheck className="size-3.5" />
            {t('{{count}} waiting', { count: summary.waiting })}
          </span>
        )}
        {summary.running > 0 ? (
          <span className="flex items-center gap-1.5 text-foreground/80">
            <LoaderCircle className="size-3.5 animate-spin text-brand motion-reduce:animate-none" />
            {t('{{count}} running', { count: summary.running })}
          </span>
        ) : (
          summary.waiting === 0 && (
            <span className="flex items-center gap-1.5">
              <CircleCheck className="size-3.5" />
              {t('Idle')}
            </span>
          )
        )}
      </span>
    </footer>
  );
}
