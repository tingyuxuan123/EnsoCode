import type { InstructionEntry } from '@shared/types';
import { FileText, HardDriveDownload, Link2, Pencil, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { InstructionEditDialog } from './InstructionEditDialog';
import { LocalAssetImportDialog } from './LocalAssetImportDialog';
import { NewSessionBadge } from './NewSessionBadge';
import {
  enabledOccupancyTotal,
  OccupancyEnabledTotal,
  OccupancyMark,
  useOccupancyRows,
} from './OccupancyMark';

const formatBytes = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

export function InstructionsSettings() {
  const { t } = useI18n();
  const instructions = useSettingsStore((state) => state.instructions);
  const updateInstruction = useSettingsStore((state) => state.updateInstruction);
  const removeInstruction = useSettingsStore((state) => state.removeInstruction);
  const [importOpen, setImportOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<InstructionEntry | 'new' | null>(null);
  const instructionIds = instructions.map((instruction) => instruction.id);
  const occupancy = useOccupancyRows(instructionIds, (ids) =>
    window.electronAPI.assets.instructionOccupancy(ids)
  );
  const enabledTokens = enabledOccupancyTotal(
    instructions.filter((instruction) => instruction.enabled).map((instruction) => instruction.id),
    occupancy.rows
  );

  return (
    <div className="space-y-[24px]" data-slot="settings-page">
      <div
        className="flex flex-wrap items-start justify-between gap-[16px] [&>[data-slot=button]]:h-[calc(32rem/14)] [&>div>[data-slot=button]]:h-[calc(32rem/14)]"
        data-settings-row="instructions.root"
      >
        <div>
          <h3 className="font-semibold text-[calc(18rem/14)] leading-[calc(26rem/14)]">
            {t('Instruction Files')}
            <OccupancyEnabledTotal tokens={enabledTokens} />
            <NewSessionBadge />
          </h3>
          <p className="text-muted-foreground text-[calc(13rem/14)]">
            {t('Global CLAUDE.md / AGENTS.md style files from local AI tools')}
          </p>
          <p className="text-muted-foreground text-[calc(12rem/14)]">
            {t('Only one file is active at a time; enabling one disables the others')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <HardDriveDownload className="mr-1.5 h-4 w-4" />
            {t('Import from local apps')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('Add instruction')}
          </Button>
        </div>
      </div>

      {instructions.length === 0 ? (
        <div className="rounded-[6px] border border-dashed px-3 py-8 text-center">
          <FileText className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-3 font-medium text-[calc(13rem/14)]">{t('No instruction files yet')}</p>
          <p className="mt-1 text-muted-foreground text-[calc(12rem/14)]">
            {t('Import instruction files from local apps or add one manually to get started')}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-[6px] border border-line">
          {instructions.map((instruction) => (
            <div
              key={instruction.id}
              className="group flex items-center justify-between gap-[12px] px-[12px] py-[10px] transition-colors hover:bg-accent/50"
              data-settings-row={`instructions.${instruction.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-[8px]">
                  <span
                    className={cn(
                      'truncate font-medium text-[calc(13rem/14)]',
                      !instruction.enabled && 'text-muted-foreground line-through'
                    )}
                  >
                    {instruction.name}
                  </span>
                  <Badge variant="secondary" className="shrink-0 text-[calc(11rem/14)]">
                    {instruction.source}
                  </Badge>
                  {!instruction.local && (
                    <Badge variant="outline" className="shrink-0 gap-1 text-[calc(11rem/14)]">
                      <Link2 className="h-3 w-3" />
                      {t('Linked')}
                    </Badge>
                  )}
                </div>
                <p className="mt-[2px] truncate text-muted-foreground text-[calc(12rem/14)]">
                  {instruction.local
                    ? `${t('Local copy')} · ${formatBytes(instruction.bytes)}`
                    : `${instruction.sourcePath} · ${formatBytes(instruction.bytes)}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <OccupancyMark
                  row={occupancy.rows[instruction.id]}
                  pending={occupancy.pending && !occupancy.rows[instruction.id]}
                />
                <Switch
                  checked={instruction.enabled}
                  onCheckedChange={(enabled) => updateInstruction(instruction.id, { enabled })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('Edit')}
                  className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                  onClick={() => setEditing(instruction)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('Remove')}
                  className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
                  onClick={() => removeInstruction(instruction.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <LocalAssetImportDialog kind="instruction" open={importOpen} onOpenChange={setImportOpen} />
      <InstructionEditDialog instruction={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
