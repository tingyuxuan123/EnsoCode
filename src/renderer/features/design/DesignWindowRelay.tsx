import type { DesignWindowActivityEvent } from '@shared/types/design';
import { useEffect, useRef } from 'react';
import { useSessionsStore } from '@/stores/sessions';
import { bindDesignWindows, chunkDesignActivity, useDesignWindows } from './host/design-windows';
import { deliverDesignPrompt } from './host/main-host';
import { createDesignToolActivity } from './host/tool-activity';

/**
 * 主窗口侧：会话投影只在主窗口里。把弹出会话的运行状态 / 工具活动推给它的独立
 * 设计窗口，并代为执行设计窗口的派活（沿用主窗口的模型解析与 sessions store 发送）。
 */
type RelayEntry = {
  tracker: ReturnType<typeof createDesignToolActivity>;
  streaming: boolean | null;
};

export function DesignWindowRelay() {
  useEffect(() => bindDesignWindows(), []);
  const sessions = useDesignWindows((state) => state.sessions);
  // 跨窗口列表变化保留：重建 tracker 会把在途调用当作历史，另一个窗口就收不到 tool-call-end。
  const entries = useRef(new Map<string, RelayEntry>());

  useEffect(() => {
    const api = window.electronAPI.designWindow;
    const map = entries.current;
    for (const id of [...map.keys()]) if (!sessions.includes(id)) map.delete(id);
    if (sessions.length === 0) return;
    const push = (id: string, force: boolean) => {
      const entry = map.get(id);
      if (!entry) return;
      const conversation = useSessionsStore.getState().conversations[id];
      const streaming = conversation?.status === 'running';
      const events = entry.tracker.sync(
        id,
        conversation?.messages ?? [],
        streaming
      ) as DesignWindowActivityEvent[];
      if (!force && events.length === 0 && streaming === entry.streaming) return;
      entry.streaming = streaming;
      for (const chunk of chunkDesignActivity(events))
        void api
          .pushState({ sessionId: id, streaming, events: chunk })
          .catch((error) => console.warn('[design] window state push failed', error));
    };
    for (const id of sessions) {
      if (map.has(id)) continue;
      map.set(id, { tracker: createDesignToolActivity(), streaming: null });
      push(id, true);
    }
    return useSessionsStore.subscribe((state, previous) => {
      for (const id of sessions)
        if (state.conversations[id] !== previous.conversations[id]) push(id, false);
    });
  }, [sessions]);

  useEffect(
    () =>
      window.electronAPI.designWindow.onPromptRequest((request) => {
        const respond = (status: 'sent' | 'queued' | 'failed', error?: string) =>
          window.electronAPI.designWindow
            .respondPrompt({ requestId: request.requestId, status, ...(error ? { error } : {}) })
            .catch((cause) => console.warn('[design] window prompt response failed', cause));
        void deliverDesignPrompt(request.sessionId, request.text, request.skipIfStreaming)
          .then((result) => respond(result.status, result.error?.message))
          .catch((error: unknown) =>
            respond('failed', error instanceof Error ? error.message : String(error))
          );
      }),
    []
  );
  return null;
}
