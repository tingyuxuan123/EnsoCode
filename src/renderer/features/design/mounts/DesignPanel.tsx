import { useEffect, useRef, useState } from 'react';
import { effectiveKeybindings } from '@/lib/keybindings';
import { useSettingsStore } from '@/stores/settings';
import type { BotDesignTarget } from '../host/bot-canvas';
import { resolveDesignRoot } from '../host/paths';
import { useDesignRegistry } from '../host/registry';
import { __ActivityTabContext } from '../host/sdk';
import { dispatchDesignShortcut } from '../host/shortcuts';
import type { PluginShortcutScopeContribution } from '../vetta/sdk/shortcuts';
import type { PluginActivityTabContribution } from '../vetta/sdk/ui';
import { getCanvasController, onCanvasController } from '../vetta/src/canvas/design-runtime';
import { CANVAS_TAB_ID } from '../vetta/src/tab-ids';
import { DesignRoot } from './DesignRoot';
import { useDesignCwd } from './useDesignCwd';

function CanvasMount({
  sessionId,
  cwd,
  component: Canvas,
  bot,
}: {
  sessionId: string;
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
        <__ActivityTabContext.Provider value={{ cwd, active: true, sessionId, bot }}>
          <Canvas />
        </__ActivityTabContext.Provider>
      </div>
    </DesignRoot>
  );
}

export function BotDesignPanel({ target }: { target: BotDesignTarget }) {
  const tab = useCanvasContribution();
  if (!tab) return null;
  return (
    <CanvasMount
      key={`${target.sessionId}:${target.projectId ?? ''}:${target.path}`}
      sessionId={target.sessionId}
      cwd={target.cwd}
      bot={target}
      component={tab.component}
    />
  );
}

function useCanvasContribution(): PluginActivityTabContribution | undefined {
  const contributions = useDesignRegistry((state) => state.contributions);
  return contributions.find(
    (item) =>
      item.kind === 'activity-tab' &&
      (item.value as PluginActivityTabContribution).id === CANVAS_TAB_ID
  )?.value as PluginActivityTabContribution | undefined;
}

/** Active-only residency: upstream's controller is a singleton, not per dock. */
export function DesignPanel({
  conversationId,
  active,
}: {
  conversationId: string;
  active: boolean;
}) {
  const tab = useCanvasContribution();
  const [ready, setReady] = useState<{ id: string; requestedCwd: string; cwd: string } | null>(
    null
  );
  const cwd = useDesignCwd(conversationId);
  useEffect(() => {
    if (!active || !cwd) return;
    let disposed = false;
    void resolveDesignRoot({ kind: 'session', sessionId: conversationId })
      .then((root) => {
        if (!disposed) setReady({ id: conversationId, requestedCwd: cwd, cwd: root.path });
      })
      .catch((error) => console.warn('[design] panel root unavailable', error));
    return () => {
      disposed = true;
    };
  }, [active, conversationId, cwd]);
  if (!active || !tab || ready?.id !== conversationId || ready.requestedCwd !== cwd) return null;
  return (
    <CanvasMount
      key={`${conversationId}:${ready.cwd}`}
      sessionId={conversationId}
      cwd={ready.cwd}
      component={tab.component}
    />
  );
}
