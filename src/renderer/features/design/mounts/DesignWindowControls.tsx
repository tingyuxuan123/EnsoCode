import { AppWindow } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { useSessionsStore } from '@/stores/sessions';
import { bindDesignWindows, designWindowRoot, useDesignWindows } from '../host/design-windows';

/** 打开（或聚焦）该会话的独立设计窗口；失败给出 toast。 */
export function useOpenDesignWindow(): (sessionId: string) => void {
  const { t } = useI18n();
  return useCallback(
    (sessionId: string) => {
      void window.electronAPI.designWindow
        .open(sessionId)
        .then((result) => {
          if (!result.ok) throw new Error(result.error);
        })
        .catch((error: unknown) =>
          addToast({
            type: 'error',
            title: t('Could not open design window'),
            description: error instanceof Error ? error.message : String(error),
          })
        );
    },
    [t]
  );
}

/** 该会话（含子会话 tab）的画布是否已弹到独立窗口。 */
export function useDesignWindowOpen(sessionId: string | undefined): boolean {
  useEffect(() => bindDesignWindows(), []);
  const root = useSessionsStore((state) =>
    sessionId ? designWindowRoot(sessionId, state.conversations) : null
  );
  return useDesignWindows((state) => Boolean(root && state.sessions.includes(root)));
}

export function DesignWindowPlaceholder({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const open = useOpenDesignWindow();
  return (
    <div
      data-slot="design-window-placeholder"
      className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-background px-8 text-center"
    >
      <AppWindow className="size-6 text-muted-foreground" />
      <p className="font-medium text-foreground text-sm">
        {t('This canvas is open in a separate window.')}
      </p>
      <p className="max-w-80 text-muted-foreground text-xs">
        {t(
          'Design requests from this session go to that window, so other projects can use the canvas at the same time.'
        )}
      </p>
      <button
        type="button"
        className="mt-1 h-7 rounded-md border px-3 text-xs hover:bg-accent/50"
        onClick={() => open(sessionId)}
      >
        {t('Show window')}
      </button>
    </div>
  );
}
