import { ClipboardList } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

/** composer 工具行的 Plan 开关：开启后只读调研，提交计划经审批再执行 */
export function PlanModeToggle({
  active,
  onToggle,
  compact = false,
}: {
  active: boolean;
  onToggle: (next: boolean) => void;
  /** composer 工具行放不下时只留图标 */
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={t('Plan')}
      title={
        active
          ? t('Plan mode is on: read-only research, then a plan for your approval')
          : t('Plan first: research read-only and submit a plan for approval')
      }
      onClick={() => onToggle(!active)}
      className={cn(
        'flex h-[calc(28rem/14)] min-w-0 shrink-0 items-center gap-[4px] rounded-[6px] text-[calc(12rem/14)] transition-colors',
        compact ? 'px-[7px]' : 'px-[8px]',
        active
          ? 'bg-primary/10 text-primary hover:bg-primary/15'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <ClipboardList className="size-[calc(14rem/14)] shrink-0" />
      {!compact && <span>{t('Plan')}</span>}
    </button>
  );
}
