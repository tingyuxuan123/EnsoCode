import type { DesignWindowState } from '@shared/types/design';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { TitleBar } from '@/components/app/TitleBar';
import { ToastProvider } from '@/components/ui/toast';
import {
  type DesignContextHost,
  emitDesignConversation,
  syncDesignConversationActivity,
} from '@/features/design/host/context';
import { useDesignLocale } from '@/features/design/host/locale';
import { CanvasMount, useCanvasContribution } from '@/features/design/mounts/CanvasMount';
import { bindDesignWindowSession } from '@/features/design/runtime';
import { useI18n } from '@/i18n';
import { PluginThemeHost } from '@/plugins/PluginThemeHost';
import { useSettingsStore } from '@/stores/settings';
import '@/features/design/vetta/src/style.css';
import './styles/globals.css';

/**
 * 独立设计窗口的宿主：只转发派活（会话由 Main 按窗口绑定补全）。会话选择、侧栏、
 * Composer 等主窗口能力不提供；本入口绝不能导入 sessions / sidePanel store。
 */
const host: DesignContextHost = {
  conversation: {
    async sendPrompt(text, canvas) {
      const result = await window.electronAPI.designWindow.prompt({
        text,
        ...(canvas?.skipIfStreaming ? { skipIfStreaming: true } : {}),
      });
      return result.error
        ? { status: result.status, error: { message: result.error } }
        : { status: result.status };
    },
  },
};

type WindowState = { sessionId: string; cwd: string } | { error: string } | null;

function DesignWindowApp() {
  const { t } = useI18n();
  const language = useSettingsStore((state) => state.language);
  React.useEffect(
    () => useDesignLocale.setState({ locale: language.startsWith('zh') ? 'zh' : 'en' }),
    [language]
  );
  const [state, setState] = React.useState<WindowState>(null);
  React.useEffect(() => {
    let disposed = false;
    let bound: string | null = null;
    // 绑定完成（conversation-changed 发出）前到达的推送先留最新一条，绑定后补上运行状态。
    let early: DesignWindowState | null = null;
    // 主窗口推来的运行状态与工具活动（画布的「修改中 / 已更新」和备注派活闸门）。
    const stop = window.electronAPI.designWindow.onState((update) => {
      if (!bound) {
        early = update;
        return;
      }
      if (update.sessionId !== bound) return;
      syncDesignConversationActivity(update.sessionId, update.streaming);
      for (const event of update.events) emitDesignConversation(event);
    });
    void (async () => {
      const info = await window.electronAPI.designWindow.info();
      if (!info.ok) throw new Error(info.error);
      const cwd = await bindDesignWindowSession(info.sessionId, info.streaming, host);
      bound = info.sessionId;
      const pending = early as DesignWindowState | null;
      if (pending?.sessionId === bound) syncDesignConversationActivity(bound, pending.streaming);
      if (!disposed) setState({ sessionId: info.sessionId, cwd });
    })().catch((error: unknown) => {
      if (!disposed) setState({ error: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      disposed = true;
      stop();
    };
  }, []);
  const tab = useCanvasContribution();
  const project =
    state && 'cwd' in state
      ? state.cwd
          .replace(/[\\/]+$/, '')
          .split(/[\\/]/)
          .pop()
      : undefined;
  const title = project ? `${project} · ${t('Design')}` : t('Design');
  React.useEffect(() => {
    document.title = title;
  }, [title]);
  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-shell text-foreground"
      data-slot="design-window"
    >
      <PluginThemeHost />
      <TitleBar title={title} />
      <div className="flex min-h-0 flex-1 overflow-hidden border-line border-t bg-background">
        {state && 'error' in state ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="text-foreground text-sm">
              {t('This design window is no longer available.')}
            </p>
            <p className="text-muted-foreground text-xs">{state.error}</p>
          </div>
        ) : state && tab ? (
          <div className="min-w-0 flex-1">
            <CanvasMount
              key={`${state.sessionId}:${state.cwd}`}
              sessionId={state.sessionId}
              cwd={state.cwd}
              component={tab.component}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
            {t('Loading…')}
          </div>
        )}
      </div>
      <ToastProvider />
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <DesignWindowApp />
  </React.StrictMode>
);
