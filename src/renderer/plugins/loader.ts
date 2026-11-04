import * as React from 'react';
import {
  Component,
  type ComponentType,
  createElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { type DraftRequest, type DraftResult, handleDraftRequest } from './draftBridge';
import { type PluginSlotEntry, pluginSlotKey, registerPluginSlot } from './registry';
import { hasActivePluginGesture } from './userGesture';
export interface PluginRendererDeps {
  importModule(pluginId: string, rel: string): Promise<{ onLoad?: (enso: unknown) => unknown }>;
  react: unknown;
  sessionId(): string | null;
  call(pluginId: string, method: string, args: unknown, sessionId: string | null): Promise<unknown>;
  draft(request: DraftRequest): DraftResult;
}
export function createRendererDeps(sessionId: () => string | null): PluginRendererDeps {
  return {
    react: React,
    sessionId,
    draft: handleDraftRequest,
    importModule: async (pluginId, rel) => {
      const result = await window.electronAPI.extensionPlugins.asset(pluginId, rel);
      if (!result.ok) throw new Error(result.error);
      const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
      try {
        return await import(/* @vite-ignore */ url);
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    call: async (pluginId, method, args, sid) => {
      const result = await window.electronAPI.extensionPlugins.call({
        pluginId,
        method: 'renderer.call',
        payload: { method, args },
        sessionId: sid,
        gesture: hasActivePluginGesture(),
      });
      if (!result.ok) throw Object.assign(new Error(result.error), { code: result.code });
      return result.value;
    },
  };
}
export async function loadPluginRenderer(
  pluginId: string,
  rel: string,
  deps: PluginRendererDeps,
  options: { draft?: boolean; tools?: string[]; active?: () => boolean; signal?: AbortSignal } = {}
): Promise<{ dispose(): void }> {
  const disposers: (() => void)[] = [];
  let disposed = false;
  const assertActive = () => {
    if (disposed || options.signal?.aborted || options.active?.() === false)
      throw Object.assign(new Error('Plugin is disabled'), { code: 'PLUGIN_DISABLED' });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    options.signal?.removeEventListener('abort', dispose);
    for (const cleanup of disposers.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.warn('[plugin] cleanup failed', error);
      }
    }
  };
  options.signal?.addEventListener('abort', dispose, { once: true });
  let mod: Awaited<ReturnType<PluginRendererDeps['importModule']>>;
  try {
    mod = await deps.importModule(pluginId, rel);
  } catch (error) {
    dispose();
    throw error;
  }
  assertActive();
  if (typeof mod.onLoad !== 'function') throw new Error('Plugin must export onLoad');
  const draft = async (op: DraftRequest['op'], payload: Record<string, unknown>) => {
    assertActive();
    const sessionId = deps.sessionId();
    if (!sessionId) throw Object.assign(new Error('No active session'), { code: 'NO_SESSION' });
    const result = deps.draft({ sessionId, op, payload });
    if (!result.ok) throw Object.assign(new Error(result.error), { code: result.code });
    return result.value;
  };
  const enso = Object.freeze({
    React: deps.react,
    slots: Object.freeze({
      register: (entry: Omit<PluginSlotEntry, 'pluginId'>) => {
        assertActive();
        if (entry.slot === 'tool.card' && !options.tools?.includes(entry.toolName ?? ''))
          throw new Error('Tool was not declared by this plugin');
        const cleanup = registerPluginSlot({ ...entry, pluginId });
        disposers.push(cleanup);
        return cleanup;
      },
    }),
    dispatch: (action: string, payload: Record<string, unknown>) => {
      assertActive();
      if (action !== 'plugin.call' || typeof payload?.method !== 'string')
        throw new Error('Unknown plugin action');
      return deps.call(pluginId, payload.method, payload.args, deps.sessionId());
    },
    ...(options.draft
      ? {
          composer: Object.freeze({
            readDraft: () => draft('readDraft', {}),
            insertText: (input: { text: string; expect: unknown }) =>
              draft('insertText', { text: input?.text, expect: input?.expect }),
            replaceDraft: (input: { text: string; expect: unknown }) =>
              draft('replaceDraft', { text: input?.text, expect: input?.expect }),
          }),
        }
      : {}),
  });
  try {
    const cleanup = await mod.onLoad(enso);
    if (typeof cleanup === 'function') {
      if (disposed) cleanup();
      else disposers.push(cleanup as () => void);
    }
    assertActive();
  } catch (error) {
    dispose();
    throw error;
  }
  return { dispose };
}
interface SlotBoundaryProps {
  entry: PluginSlotEntry;
  children?: ReactNode;
  fallback: ReactNode;
  retryPhase?: boolean | string;
}

class PluginSlotErrorBoundary extends Component<
  SlotBoundaryProps,
  { failed: boolean; retryPhase?: boolean | string }
> {
  state = { failed: false, retryPhase: this.props.retryPhase };

  static getDerivedStateFromProps(
    { retryPhase }: SlotBoundaryProps,
    state: PluginSlotErrorBoundary['state']
  ) {
    // A partial stream can fail to parse. Retry at its next phase, not on each chunk.
    return state.retryPhase === retryPhase ? null : { failed: false, retryPhase };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    const { pluginId, slot } = this.props.entry;
    console.warn(`[plugin] ${pluginId} failed to render ${slot}`, error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function PluginSlotView({
  entry,
  props,
  fallback = null,
  retryPhase,
}: {
  entry: PluginSlotEntry;
  props: Record<string, unknown>;
  fallback?: ReactNode;
  retryPhase?: boolean | string;
}): ReactElement {
  return createElement(
    PluginSlotErrorBoundary,
    {
      // A new registration after reload must not inherit the previous component's error.
      key: pluginSlotKey(entry),
      entry,
      fallback,
      retryPhase,
    },
    createElement(entry.component as ComponentType<Record<string, unknown>>, props)
  );
}
