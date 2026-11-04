import { useI18n } from '@/i18n';
import type { ToolNotice } from '@/stores/sessions/timeline';

/** 工具结果前捎带给模型的系统提醒：不是工具输出，默认收起，需要时可展开核对 */
export function ToolNotices({ notices }: { notices: ToolNotice[] }) {
  const { t } = useI18n();
  if (notices.length === 0) return null;
  return (
    <details
      data-slot="tool-notices"
      className="border-t border-border/60 px-3 py-1.5 text-[calc(11rem/14)] text-muted-foreground first:border-t-0"
    >
      <summary className="cursor-pointer hover:text-foreground">
        {t('System reminders')} · {notices.length}
      </summary>
      <pre className="mt-1 whitespace-pre-wrap font-mono leading-relaxed">
        {notices.map((notice) => notice.text).join('\n\n')}
      </pre>
    </details>
  );
}
