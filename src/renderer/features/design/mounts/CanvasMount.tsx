import { useEffect, useRef } from 'react';
import { effectiveKeybindings } from '@/lib/keybindings';
import { useSettingsStore } from '@/stores/settings';
import { useDesignRegistry } from '../host/registry';
import { __ActivityTabContext } from '../host/sdk';
import { dispatchDesignShortcut } from '../host/shortcuts';
import type { PluginShortcutScopeContribution } from '../vetta/sdk/shortcuts';
import type { PluginActivityTabContribution } from '../vetta/sdk/ui';
import { getCanvasController, onCanvasController } from '../vetta/src/canvas/design-runtime';
import { CANVAS_TAB_ID } from '../vetta/src/tab-ids';
import { DesignRoot } from './DesignRoot';

/*
 * 画布挂载点：主窗口 Dock、Bot 工作区和独立设计窗口共用。
 * 不得导入 sessions / sidePanel 等主窗口 store（独立设计窗口也加载本文件）。
 */

export function CanvasMount({
  sessionId,
  cwd,
  component: Canvas,
  bot,
}: {
  sessionId: string | null;
  cwd: string;
  component: PluginActivityTabContribution['component'];
  bot?: { chatId: string; path: string };
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const report = (open: boolean) => {
      if (open || useDesignRegistry.getState().canvasSessionId === sessionId) {
        useDesignRegistry.setState({ canvasSessionId: open ? sessionId : null });
      }
      void window.electronAPI.design
        .reportCanvas({ sessionId, open })
        .then((result) => {
          if (!result.ok) console.warn('[design] canvas report failed', result.error);
        })
        .catch((error) => console.warn('[design] canvas report failed', error));
    };
    const stop = onCanvasController((controller) =>
      report(controller !== null && getCanvasController(cwd, bot?.chatId ?? null) === controller)
    );
    return () => {
      stop();
      report(false);
    };
  }, [sessionId, cwd, bot?.chatId]);
  return (
    <DesignRoot>
      <div
        ref={rootRef}
        data-design-panel=""
        tabIndex={-1}
        className="h-full min-h-0 outline-none"
        onPointerDownCapture={(event) => {
          if (
            !(event.target instanceof Element) ||
            event.target.closest('input,textarea,select,button,[contenteditable="true"]')
          )
            return;
          rootRef.current?.focus({ preventScroll: true });
        }}
        onKeyDownCapture={(event) => {
          if (!rootRef.current?.contains(document.activeElement)) return;
          const target = event.target;
          const editable =
            target instanceof Element &&
            Boolean(
              target.closest(
                'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'
              )
            );
          const scopes = useDesignRegistry
            .getState()
            .contributions.filter((item) => item.kind === 'shortcut')
            .map((item) => item.value as PluginShortcutScopeContribution);
          dispatchDesignShortcut(
            event.nativeEvent,
            scopes,
            editable,
            Object.values(effectiveKeybindings(useSettingsStore.getState().keybindings))
          );
        }}
      >
        <__ActivityTabContext.Provider
          value={{ cwd, active: true, sessionId: sessionId ?? undefined, bot }}
        >
          <Canvas />
        </__ActivityTabContext.Provider>
      </div>
    </DesignRoot>
  );
}

export function useCanvasContribution(): PluginActivityTabContribution | undefined {
  const contributions = useDesignRegistry((state) => state.contributions);
  return contributions.find(
    (item) =>
      item.kind === 'activity-tab' &&
      (item.value as PluginActivityTabContribution).id === CANVAS_TAB_ID
  )?.value as PluginActivityTabContribution | undefined;
}
