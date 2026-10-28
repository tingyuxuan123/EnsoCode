import { projectDisplayName } from '@shared/projectName';
import { motion } from 'framer-motion';
import { useI18n } from '@/i18n';
import { springStandard } from '@/lib/motion';
import { useSessionsStore } from '@/stores/sessions';
import { displayedConversationId } from '@/stores/sessions/chatChrome';
import { useSettingsStore } from '@/stores/settings';

/**
 * 品牌留在导航区，会话标题跟随侧栏边界；收起时避开原生窗口按钮。
 * 只读正在查看的会话（含 coworker 页签），不提供额外操作（重命名仍在会话页签/侧栏）。
 */
export function WorkbenchTitle({
  sidebarWidth,
  sidebarCollapsed,
  showBrand = true,
}: {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  showBrand?: boolean;
}) {
  const { t } = useI18n();
  // 跟随正在查看的会话：选中 coworker 页签时显示该协作者的标题
  const activeId = useSessionsStore(displayedConversationId);
  const title = useSessionsStore((s) => (activeId ? s.conversations[activeId]?.title : undefined));
  const projectId = useSessionsStore((s) =>
    activeId ? s.conversations[activeId]?.projectId : undefined
  );
  const project = useSettingsStore((s) => s.projects.find((p) => p.id === projectId));

  return (
    <div className="flex min-w-0 flex-1 items-center">
      <motion.div
        data-slot="workbench-title-leading"
        initial={false}
        animate={{ width: 56 + (sidebarCollapsed ? 0 : sidebarWidth + 1) }}
        transition={springStandard}
        className="flex shrink-0 items-center overflow-hidden"
        style={{
          minWidth: 'var(--titlebar-left-inset)',
          marginLeft: 'calc(-1 * var(--titlebar-left-inset))',
          paddingLeft: 'var(--titlebar-left-inset)',
        }}
      >
        {showBrand && !sidebarCollapsed && (
          <span className="truncate pr-3 text-[calc(12rem/14)] font-medium text-muted-foreground max-[650px]:hidden">
            EnsoCode
            <span className="ml-2 font-normal text-muted-foreground/80">{t('Workbench')}</span>
          </span>
        )}
      </motion.div>
      {activeId && (
        <div className="flex min-w-0 flex-1 items-center gap-2 px-[16px]">
          <span
            data-slot="workbench-session-title"
            className="truncate text-[calc(13rem/14)] font-medium text-foreground"
          >
            {title || t('New conversation')}
          </span>
          {project && (
            <span className="shrink-0 rounded-md bg-accent/70 px-2 py-0.5 text-[calc(11rem/14)] text-muted-foreground">
              {projectDisplayName(project)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
