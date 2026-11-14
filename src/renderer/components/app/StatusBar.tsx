import { LoaderCircle, Monitor, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useRemoteNodesStore } from '@/stores/remoteNodes';
import { useSessionsStore } from '@/stores/sessions';
import { RailTip } from './RailTip';
import { summarizeWorkbench } from './statusBarSummary';

/**
 * 图标轨上的只读摘要：保留全局运行 / 待处理计数及远程异常，空闲时不占位。
 * 计数始终属于本机会话，切到远程节点或其它工作模式也不丢失。
 */
export function StatusBar() {
  const { t } = useI18n();
  const nodes = useRemoteNodesStore((s) => s.nodes);
  const activeNodeId = useRemoteNodesStore((s) => s.activeNodeId);
  const conversations = useSessionsStore((s) => s.conversations);
  const summary = useMemo(() => summarizeWorkbench(conversations), [conversations]);

  const remote = activeNodeId === 'local' ? null : nodes.find((n) => n.nodeId === activeNodeId);
  const remoteUnavailable = remote && !remote.hostOnline;
  if (!remoteUnavailable && summary.waiting === 0 && summary.running === 0) return null;

  return (
    <div
      data-slot="workbench-status"
      role="status"
      aria-label={t('Workbench')}
      aria-atomic="true"
      className="flex shrink-0 flex-col items-center gap-1"
    >
      {remoteUnavailable && (
        <StatusItem
          status="remote"
          label={`${remote.label} · ${remote.connected ? t('Remote desktop is offline') : t('Connecting…')}`}
          className="text-warning"
          icon={<Monitor className="size-[14px] shrink-0" />}
        />
      )}
      {summary.waiting > 0 && (
        <StatusItem
          status="waiting"
          label={`${t('This computer')} · ${t('{{count}} waiting', { count: summary.waiting })}`}
          className="text-warning"
          icon={<ShieldAlert className="size-[14px] shrink-0" />}
          count={summary.waiting}
        />
      )}
      {summary.running > 0 && (
        <StatusItem
          status="running"
          label={`${t('This computer')} · ${t('{{count}} running', { count: summary.running })}`}
          icon={
            <LoaderCircle className="size-[14px] shrink-0 animate-spin text-brand motion-reduce:animate-none" />
          }
          count={summary.running}
        />
      )}
    </div>
  );
}

function StatusItem({
  status,
  label,
  className,
  icon,
  count,
}: {
  status: string;
  label: string;
  className?: string;
  icon: ReactNode;
  count?: number;
}) {
  return (
    <RailTip label={label}>
      <span
        role="img"
        data-status={status}
        aria-label={label}
        title={label}
        className={cn(
          'flex min-h-[24px] w-[44px] items-center justify-center gap-[3px] text-[calc(9rem/14)] text-muted-foreground tabular-nums',
          className
        )}
      >
        {icon}
        {count !== undefined && <span aria-hidden>{count > 99 ? '99+' : count}</span>}
      </span>
    </RailTip>
  );
}
