import type { SessionWorktree, WorktreeStatus } from '@shared/types/worktree';
import { GitBranch } from 'lucide-react';
import type { ReactNode } from 'react';
import { type TFunction, useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { worktreeDisplayName } from './worktreeUi';

export function worktreeHoverText(
  worktree: SessionWorktree,
  status: WorktreeStatus | undefined,
  t: TFunction
): string {
  const state =
    status?.exists === false
      ? t('Worktree missing')
      : !status
        ? t('Worktree status unknown')
        : [
            status.dirty ? t('Uncommitted changes') : t('Working tree clean'),
            ...(status.ahead > 0 ? [t('{{n}} unmerged commits', { n: status.ahead })] : []),
          ].join(' · ');
  return [worktreeDisplayName(worktree), worktree.branch, worktree.path, state].join('\n');
}

export function WorktreeBadge({
  worktree,
  status,
  after,
}: {
  worktree: SessionWorktree;
  status?: WorktreeStatus;
  after?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <span
      data-slot="worktree-label"
      title={worktreeHoverText(worktree, status, t)}
      className="col-span-2 grid min-w-0 grid-cols-subgrid items-center text-[calc(11rem/14)] leading-4 text-muted-foreground/70"
    >
      <span className="relative flex h-3 min-w-0 items-center justify-center">
        <GitBranch
          className={cn(
            'absolute h-3 w-3 shrink-0',
            status?.exists === false
              ? 'text-destructive'
              : status?.dirty
                ? 'text-warning'
                : (status?.ahead ?? 0) > 0
                  ? 'text-info'
                  : 'text-muted-foreground/60'
          )}
        />
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate">{worktreeDisplayName(worktree)}</span>
        {after}
      </span>
    </span>
  );
}
