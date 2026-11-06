import type { DesignToolRequestEvent } from '@shared/types/design';
import { setDesignViewingCwd } from './host/canvas-target';
import {
  createDesignContext,
  type DesignContextHost,
  emitDesignConversation,
} from './host/context';
import { resolveDesignRoot } from './host/paths';
import { designTools } from './host/registry';
import { dispatchDesignHook, dispatchDesignTool } from './runtime-dispatch';

let started: Promise<void> | undefined;
let viewingSessionId: string | null = null;
const requests = new Map<string, AbortController>();

/** Schemas come from upstream registrations, not a second renderer declaration. */
export function listRegisteredDesignTools(): Array<{
  name: string;
  description: string;
  parameters: object;
}> {
  return [...designTools].map(([name, tool]) => ({
    name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}
/**
 * 每个 renderer 只激活一次。宿主由窗口注入：主窗口传 main-host，独立设计窗口传
 * 只转发派活的宿主。本文件不导入任何主窗口 store。
 */
export function startDesignRuntime(host: DesignContextHost): Promise<void> {
  if (started) return started;
  const attempt = (async () => {
    const ctx = createDesignContext(host);
    const plugin = (await import('./vetta/src/index')).default;
    await plugin.activate(ctx);
    // Listeners subscribe only after a successful activation, so a retry never doubles them.
    const api = window.electronAPI.design;
    api.onToolRequest((request: DesignToolRequestEvent) => {
      if (requests.has(request.requestId)) return;
      const controller = new AbortController();
      requests.set(request.requestId, controller);
      void (async () => {
        try {
          const root = await resolveDesignRoot({
            kind: 'session',
            sessionId: request.session.sessionId,
          });
          const result = await dispatchDesignTool(
            { ...request, session: { ...request.session, cwd: root.path } },
            controller.signal,
            ctx
          );
          await api.respondTool({ requestId: request.requestId, ok: true, result });
        } catch (error) {
          await api.respondTool({
            requestId: request.requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          requests.delete(request.requestId);
        }
      })().catch((error) => console.warn('[design] tool response failed', error));
    });
    api.onToolCancel(({ requestId }) =>
      requests.get(requestId)?.abort(new DOMException('Design tool cancelled', 'AbortError'))
    );
    // Serialize hooks per session: Stop must not race the preceding prompt title.
    const hookQueues = new Map<string, Promise<void>>();
    api.onHook((event) => {
      const previous = hookQueues.get(event.sessionId) ?? Promise.resolve();
      const next = previous
        .then(async () => {
          const root = await resolveDesignRoot({ kind: 'session', sessionId: event.sessionId });
          await dispatchDesignHook({ ...event, cwd: root.path }, ctx);
        })
        .catch((error) => console.warn('[design] hook failed', error));
      hookQueues.set(event.sessionId, next);
      void next.then(() => {
        if (hookQueues.get(event.sessionId) === next) hookQueues.delete(event.sessionId);
      });
    });
  })();
  // Registration with Main lives in setDesignViewingSession (re-sent on every session
  // change), so a transient IPC failure is retried instead of being cached forever.
  const guarded: Promise<void> = attempt.catch((error) => {
    if (started === guarded) started = undefined;
    throw error;
  });
  started = guarded;
  return guarded;
}
export async function setDesignViewingSession(
  id: string | null,
  host: DesignContextHost,
  streaming: boolean
): Promise<void> {
  viewingSessionId = id;
  setDesignViewingCwd(null);
  await startDesignRuntime(host);
  if (viewingSessionId !== id) return;
  const root = id
    ? await resolveDesignRoot({ kind: 'session', sessionId: id }).catch(() => null)
    : null;
  if (viewingSessionId !== id) return;
  emitDesignConversation({
    type: 'conversation-changed',
    conversation: {
      id,
      cwd: root?.path ?? null,
      sessionPath: null,
      model: null,
      isStreaming: Boolean(id && streaming),
    },
  });
  const result = await window.electronAPI.design.registerRuntime({ viewingSessionId: id });
  if (!result.ok) throw new Error(result.error);
}

/**
 * 独立设计窗口：运行时固定服务 Main 绑定的会话。Main 登记时忽略这里上报的会话，
 * 只按窗口绑定路由；这里仍按同一会话发出，便于和 conversation 状态保持一致。
 */
export async function bindDesignWindowSession(
  sessionId: string,
  streaming: boolean,
  host: DesignContextHost
): Promise<string> {
  viewingSessionId = sessionId;
  await startDesignRuntime(host);
  const root = await resolveDesignRoot({ kind: 'session', sessionId });
  emitDesignConversation({
    type: 'conversation-changed',
    conversation: {
      id: sessionId,
      cwd: root.path,
      sessionPath: null,
      model: null,
      isStreaming: streaming,
    },
  });
  const result = await window.electronAPI.design.registerRuntime({ viewingSessionId: sessionId });
  if (!result.ok) throw new Error(result.error);
  return root.path;
}
