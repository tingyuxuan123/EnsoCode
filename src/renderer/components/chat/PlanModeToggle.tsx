import { ClipboardList } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

/** composer 工具行的 Plan 开关：开启后只读调研，提交计划经审批再执行 */
export function PlanModeToggle({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: (next: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-pressed={active}
      title={
        active
          ? t('Plan mode is on: read-only research, then a plan for your approval')
          : t('Plan first: research read-only and submit a plan for approval')
      }
      onClick={() => onToggle(!active)}
      className={cn(
        'flex h-[28px] min-w-0 shrink-0 items-center gap-[4px] rounded-[6px] px-[8px] text-[12px] transition-colors',
        active
          ? 'bg-primary/10 text-primary hover:bg-primary/15'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <ClipboardList className="size-[14px] shrink-0" />
      <span className="hidden @min-[28rem]:inline">{t('Plan')}</span>
    </button>
  );
}
