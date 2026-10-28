import { PopDigits } from '@/components/ui/pop-digits';
import { useI18n } from '@/i18n';

interface StatCardProps {
  label: string;
  value: string;
  /** 相对上期变化（'+86.4%' / 'new' / null） */
  delta: string | null;
}

/** 同设计纵向排列；对比保持中性，不把费用上涨解释为好事。 */
export function StatCard({ label, value, delta }: StatCardProps) {
  const { t } = useI18n();
  return (
    <div className="min-w-0 py-[4px]">
      <p className="text-[calc(11rem/14)] text-muted-foreground">{label}</p>
      <div
        className="mt-[2px] truncate text-[calc(20rem/14)] font-medium leading-[calc(28rem/14)] tabular-nums"
        title={value}
      >
        <PopDigits value={value} />
      </div>
      {delta && (
        <p className="text-[calc(11rem/14)] tabular-nums text-muted-foreground">
          {delta === 'new' ? t('New this period') : t('{{delta}} vs previous period', { delta })}
        </p>
      )}
    </div>
  );
}
