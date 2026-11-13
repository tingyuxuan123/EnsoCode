import type { WorkspaceBranch, WorkspaceBranches } from '@shared/types/worktree';
import { Check, GitBranch, Loader2, MessageSquarePlus, Plus, Search } from 'lucide-react';
import type { RefObject } from 'react';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { workspaceBranchFeedback } from './workspaceBranchFeedback';

export interface WorkspaceBranchListProps {
  data: WorkspaceBranches | null;
  loading: boolean;
  error: string | null;
  disabled: boolean;
  query: string;
  searchRef?: RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onSelect: (branch: WorkspaceBranch) => void;
  onCreate: () => void;
  onRetry: () => void;
}

export function WorkspaceBranchList({
  data,
  loading,
  error,
  disabled,
  query,
  searchRef,
  onQueryChange,
  onSelect,
  onCreate,
  onRetry,
}: WorkspaceBranchListProps) {
  const { t } = useI18n();
  const blocked = disabled || loading || Boolean(error) || !data || Boolean(data.blockedReason);
  const branches =
    data?.branches.filter((branch) =>
      branch.name.toLowerCase().includes(query.trim().toLowerCase())
    ) ?? [];
  return (
    <section
      aria-label={t('Local branches')}
      className="pb-1"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            'button[data-branch-row]:not(:disabled)'
          )
        );
        if (!buttons.length) return;
        event.preventDefault();
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        const next =
          index < 0
            ? event.key === 'ArrowDown'
              ? 0
              : buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      <div className="relative m-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label={t('Search local branches')}
          placeholder={t('Search local branches')}
          className="h-8 text-xs [&_input]:pl-7"
        />
      </div>
      <p className="px-2 py-1 text-[11px] text-muted-foreground">
        {t('Switching branches affects all conversations in this workspace.')}
      </p>
      {data?.blockedReason && (
        <p role="status" className="px-2 py-1 text-xs text-warning">
          {workspaceBranchFeedback(data.blockedReason, t)}
        </p>
      )}
      {loading ? (
        <div
          role="status"
          className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('Loading...')}
        </div>
      ) : error ? (
        <div role="alert" className="px-2 py-2 text-xs">
          <p className="break-words text-destructive">{error}</p>
          <button
            type="button"
            disabled={disabled}
            onClick={onRetry}
            className="mt-1 rounded px-1 py-1 text-foreground hover:bg-muted disabled:opacity-50"
          >
            {t('Retry')}
          </button>
        </div>
      ) : (
        <div className="max-h-48 overflow-y-auto">
          {branches.map((branch) => {
            const current = branch.name === data?.currentBranch;
            const newConversation = branch.occupied && Boolean(branch.worktreeConversationId);
            const hint = newConversation
              ? t('New conversation in this worktree')
              : branch.occupied
                ? t('Branch is checked out in another worktree.')
                : null;
            return (
              <button
                key={branch.name}
                type="button"
                data-branch-row=""
                aria-current={current || undefined}
                disabled={blocked || current || (branch.occupied && !newConversation)}
                title={hint ? `${branch.name}\n${hint}` : branch.name}
                onClick={() => onSelect(branch)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm disabled:opacity-50',
                  current ? 'bg-selection text-selection-foreground' : 'hover:bg-muted'
                )}
              >
                {newConversation ? (
                  <MessageSquarePlus className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <GitBranch className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{branch.name}</span>
                  {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
                </span>
                {current && <Check className="h-3.5 w-3.5 shrink-0 text-brand" />}
              </button>
            );
          })}
          {data && branches.length === 0 && (
            <p className="m-1 rounded-md border border-dashed px-2 py-3 text-center text-xs text-muted-foreground">
              {t('No matching local branches.')}
            </p>
          )}
        </div>
      )}
      <button
        type="button"
        disabled={blocked || !data?.headCommit}
        onClick={onCreate}
        title={
          data && !data.headCommit
            ? t('Create a commit before creating a branch from HEAD.')
            : undefined
        }
        className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5 shrink-0" />
        {t('Create branch from HEAD…')}
      </button>
    </section>
  );
}
