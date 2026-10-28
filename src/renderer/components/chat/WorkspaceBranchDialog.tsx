import type { WorkspaceBranches } from '@shared/types/worktree';
import { Loader2 } from 'lucide-react';
import { type RefObject, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/i18n';
import { workspaceBranchFeedback } from './workspaceBranchFeedback';

export interface WorkspaceBranchDialogProps {
  initialName: string;
  data: WorkspaceBranches | null;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  returnFocus: RefObject<HTMLButtonElement | null>;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

export function WorkspaceBranchDialog({
  initialName,
  data,
  busy,
  disabled,
  error,
  returnFocus,
  onSubmit,
  onClose,
}: WorkspaceBranchDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const duplicate = data?.branches.some((branch) => branch.name === name.trim());
  const blocked =
    busy ||
    disabled ||
    !data?.headCommit ||
    Boolean(data.blockedReason) ||
    !name.trim() ||
    duplicate;
  const validationError = duplicate
    ? t('A branch with this name already exists.')
    : data?.blockedReason
      ? workspaceBranchFeedback(data.blockedReason, t)
      : data && !data.headCommit
        ? t('Create a commit before creating a branch from HEAD.')
        : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-w-sm"
        initialFocus={inputRef}
        finalFocus={returnFocus}
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>{t('Create branch')}</DialogTitle>
          <DialogDescription>
            {t(
              'Creates a branch from the current HEAD and switches every conversation in this workspace to it.'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Input
            ref={inputRef}
            aria-label={t('Branch name')}
            aria-invalid={Boolean(validationError)}
            aria-describedby={validationError || error ? errorId : undefined}
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (!blocked) onSubmit(name.trim());
              }
            }}
          />
          {(validationError || error) && (
            <p
              id={errorId}
              role="alert"
              className="mt-2 break-words text-[calc(11rem/14)] text-destructive"
            >
              {validationError || error}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={Boolean(blocked)}
            onClick={() => {
              if (!blocked) onSubmit(name.trim());
            }}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('Create and switch')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
