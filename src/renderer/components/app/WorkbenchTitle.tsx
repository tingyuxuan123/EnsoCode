import { useI18n } from '@/i18n';

/**
 * 标题栏左侧只保留品牌字；会话标题由聊天页签承载（对齐上游顶栏组织），
 * 不再在这里重复一份可截断的标题。
 */
export function WorkbenchTitle() {
  const { t } = useI18n();

  return (
    <div className="flex min-w-0 flex-1 items-center">
      <span
        data-slot="workbench-brand"
        className="truncate pr-3 text-[calc(12rem/14)] font-medium text-muted-foreground max-[650px]:hidden"
      >
        Collabra
        <span className="ml-2 font-normal text-muted-foreground/80">{t('Workbench')}</span>
      </span>
    </div>
  );
}
