import type { DesignToolRequestEvent } from '@shared/types/design';
import { createDesignContext, emitDesignConversation } from './host/context';
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
export function startDesignRuntime(): Promise<void> {
  if (started) return started;
  const attempt = (async () => {
    const ctx = createDesignContext();
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
          await resolveDesignRoot({ kind: 'session', sessionId: request.session.sessionId });
          const result = await dispatchDesignTool(request, controller.signal, ctx);
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
          await resolveDesignRoot({ kind: 'session', sessionId: event.sessionId });
          await dispatchDesignHook(event, ctx);
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
export async function setDesignViewingSession(id: string | null): Promise<void> {
  viewingSessionId = id;
  await startDesignRuntime();
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
      isStreaming: false,
    },
  });
  const result = await window.electronAPI.design.registerRuntime({ viewingSessionId: id });
  if (!result.ok) throw new Error(result.error);
}
