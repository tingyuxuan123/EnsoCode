import { useEffect, useState } from 'react';
import type { BotDesignTarget } from '../host/bot-canvas';
import { resolveDesignRoot } from '../host/paths';
import { CanvasMount, useCanvasContribution } from './CanvasMount';
import { DesignWindowPlaceholder, useDesignWindowOpen } from './DesignWindowControls';
import { useDesignCwd } from './useDesignCwd';

export function BotDesignPanel({ target }: { target: BotDesignTarget }) {
  const tab = useCanvasContribution();
  if (!tab) return null;
  return (
    <CanvasMount
      key={`${target.sessionId}:${target.projectId ?? ''}:${target.path}`}
      sessionId={target.sessionId ?? null}
      cwd={target.cwd}
      bot={target}
      component={tab.component}
    />
  );
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
  // 已弹到独立窗口：主窗口不再挂第二个画布，避免两处 controller 争同一份设计。
  const poppedOut = useDesignWindowOpen(conversationId);
  useEffect(() => {
    if (!active || !cwd || poppedOut) return;
    let disposed = false;
    void resolveDesignRoot({ kind: 'session', sessionId: conversationId })
      .then((root) => {
        if (!disposed) setReady({ id: conversationId, requestedCwd: cwd, cwd: root.path });
      })
      .catch((error) => console.warn('[design] panel root unavailable', error));
    return () => {
      disposed = true;
    };
  }, [active, conversationId, cwd, poppedOut]);
  if (active && poppedOut) return <DesignWindowPlaceholder sessionId={conversationId} />;
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
