import type { TaskBoardWindowResult } from '@shared/types/taskBoard';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { TitleBar } from '@/components/app/TitleBar';
import { GlobalTaskBoard } from '@/components/bots/GlobalTaskBoard';
import { addToast, ToastProvider } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { useBotsStore } from '@/stores/bots';
import { useSettingsStore } from '@/stores/settings';
import './styles/globals.css';

function TaskBoardApp() {
  // Importing the settings store hydrates theme/font/locale and binds cross-window updates,
  // as in settings.tsx. This window only adds its own Bot event subscription.
  const enabled = useSettingsStore((state) => state.botModeEnabled);
  const { t } = useI18n();
  React.useEffect(() => {
    if (enabled) return useBotsStore.getState().bind();
  }, [enabled]);

  const report = (action: Promise<TaskBoardWindowResult>) => {
    void action
      .then((result) => {
        if (!result.ok) throw new Error(result.error);
      })
      .catch((error: unknown) => {
        addToast({
          type: 'error',
          title: t('Error'),
          description: error instanceof Error ? error.message : String(error),
        });
      });
  };

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-shell text-foreground"
      data-slot="taskboard-window"
    >
      <TitleBar title={t('Collaboration board')} />
      <div className="flex min-h-0 flex-1 overflow-hidden border-line border-t">
        <GlobalTaskBoard
          enabled={enabled}
          onBack={() => report(window.electronAPI.taskBoard.focusMain())}
          onOpenTask={(chatId, taskId) =>
            report(window.electronAPI.taskBoard.navigate({ kind: 'task', chatId, taskId }))
          }
          onOpenGroup={(chatId) =>
            report(window.electronAPI.taskBoard.navigate({ kind: 'group', chatId }))
          }
        />
      </div>
      <ToastProvider />
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <TaskBoardApp />
  </React.StrictMode>
);
