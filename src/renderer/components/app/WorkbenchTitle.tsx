import { projectDisplayName } from '@shared/projectName';
import { useI18n } from '@/i18n';
import { useSessionsStore } from '@/stores/sessions';
import { displayedConversationId } from '@/stores/sessions/chatChrome';
import { useSettingsStore } from '@/stores/settings';

/**
 * 标题栏左侧：产品名 + 当前会话标题 + 所属项目标签。
 * 只读正在查看的会话（含 coworker 页签），不提供额外操作（重命名仍在会话页签/侧栏）。
 */
export function WorkbenchTitle({ showBrand = true }: { showBrand?: boolean }) {
  const { t } = useI18n();
  // 跟随正在查看的会话：选中 coworker 页签时显示该协作者的标题
  const activeId = useSessionsStore(displayedConversationId);
  const title = useSessionsStore((s) => (activeId ? s.conversations[activeId]?.title : undefined));
  const projectId = useSessionsStore((s) =>
    activeId ? s.conversations[activeId]?.projectId : undefined
  );
  const project = useSettingsStore((s) => s.projects.find((p) => p.id === projectId));

  return (
    <div className="flex min-w-0 items-center">
      {showBrand && (
        <span className="w-[230px] shrink-0 truncate text-[12px] font-medium text-muted-foreground max-[800px]:w-[150px] max-[650px]:hidden">
          EnsoCode
          <span className="ml-2 font-normal text-muted-foreground/80">{t('Workbench')}</span>
        </span>
      )}
      {activeId && (
        <div className="flex min-w-0 items-center gap-2 px-2">
          <span className="truncate text-[13px] font-medium text-foreground">
            {title || t('New conversation')}
          </span>
          {project && (
            <span className="shrink-0 rounded-md bg-accent/70 px-2 py-0.5 text-[11px] text-muted-foreground">
              {projectDisplayName(project)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
