import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  MainToPluginHost,
  PluginCallMethod,
  PluginErrorShape,
  PluginHostApi,
  PluginHostToMain,
  PluginToolResult,
} from '@shared/extensionPlugins/protocol';
export interface HostTransport {
  send(message: PluginHostToMain): void;
  onMessage(handler: (message: unknown) => void): void;
}
interface Invocation {
  id: string;
  controller: AbortController;
}
interface HandlerContext {
  sessionId: string | null;
  projectRoot: string | null;
  invocationId: string;
  signal: AbortSignal;
}
type Handler = (...args: unknown[]) => unknown;
interface TriggerHandlers {
  candidates(query: string, ctx: HandlerContext): unknown;
  pick(item: unknown, ctx: HandlerContext): unknown;
}
const error = (code: string, message: string) => Object.assign(new Error(message), { code });
function errorShape(e: unknown): PluginErrorShape {
  return {
    code: e instanceof Error && 'code' in e && typeof e.code === 'string' ? e.code : 'PLUGIN_ERROR',
    message: e instanceof Error ? e.message : String(e),
  };
}
function toolResult(value: unknown): PluginToolResult {
  if (typeof value === 'string') return { content: value };
  if (value && typeof value === 'object' && 'content' in value && typeof value.content === 'string')
    return { content: value.content, ...('details' in value ? { details: value.details } : {}) };
  return { content: JSON.stringify(value ?? null) };
}
/** Isolation is for lifecycle/crash containment, not a Node sandbox. */
export function runPluginHost(transport: HostTransport): void {
  const tools = new Map<string, Handler>();
  const commands = new Map<string, Handler>();
  const triggers = new Map<string, TriggerHandlers>();
  const renderer = new Map<string, Handler>();
  const pending = new Map<
    string,
    { resolve(v: unknown): void; reject(e: Error): void; invocationId?: string }
  >();
  const invocations = new Map<string, Invocation>();
  const current = new AsyncLocalStorage<Invocation>();
  let next = 1;
  let initialized = false;
  const hostCall = (api: PluginHostApi, args: unknown): Promise<unknown> => {
    const inv = current.getStore();
    if (inv?.controller.signal.aborted) return Promise.reject(error('ABORTED', '调用已取消'));
    const id = `h${next++}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, invocationId: inv?.id });
      transport.send({ t: 'call', id, api, args, ...(inv ? { invocationId: inv.id } : {}) });
    });
  };
  const register =
    <T>(map: Map<string, T>) =>
    (name: string, handler: T) => {
      if (typeof name !== 'string' || !handler) throw new TypeError('注册参数不合法');
      map.set(name, handler);
      return () => {
        if (map.get(name) === handler) map.delete(name);
      };
    };
  const api = (pluginId: string, dataDir: string) =>
    Object.freeze({
      pluginId,
      dataDir,
      tools: { register: register(tools) },
      commands: { register: register(commands) },
      triggers: { register: register(triggers) },
      renderer: { handle: register(renderer) },
      fs: {
        readText: (path: string) => hostCall('fs.readText', { path }),
        writeText: (path: string, text: string) => hostCall('fs.writeText', { path, text }),
      },
      net: {
        fetch: (url: string, init?: unknown) => hostCall('net.fetch', { url, init: init ?? {} }),
      },
      ui: { notify: (title: string, body = '') => hostCall('ui.notify', { title, body }) },
      composer: {
        readDraft: () => hostCall('composer.readDraft', {}),
        insertText: (input: unknown) => hostCall('composer.insertText', input),
        replaceDraft: (input: unknown) => hostCall('composer.replaceDraft', input),
      },
      session: { messages: () => hostCall('session.messages', {}) },
      config: { get: () => hostCall('config.get', {}) },
      mcp: {
        tools: () => hostCall('mcp.tools', {}),
        call: (server: string, tool: string, args: unknown = {}) =>
          hostCall('mcp.call', { server, tool, args }),
      },
    });
  const dispatch = async (method: PluginCallMethod, payload: unknown, ctx: HandlerContext) => {
    const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const get = <T>(map: Map<string, T>, key: unknown): T => {
      const h = typeof key === 'string' ? map.get(key) : undefined;
      if (!h) throw error('NOT_FOUND', '插件未注册处理器');
      return h;
    };
    switch (method) {
      case 'tool.execute':
        return toolResult(await get(tools, p.name)(p.args ?? {}, ctx));
      case 'command.run':
        await get(commands, p.id)(ctx);
        return null;
      case 'trigger.candidates':
        return (await get(triggers, p.name).candidates(String(p.query ?? ''), ctx)) ?? [];
      case 'trigger.pick':
        return (await get(triggers, p.name).pick(p.item, ctx)) ?? null;
      case 'renderer.call':
        return (await get(renderer, p.method)(p.args, ctx)) ?? null;
    }
  };
  const onCall = async (m: Extract<MainToPluginHost, { t: 'call' }>) => {
    const inv = { id: m.invocationId, controller: new AbortController() };
    invocations.set(inv.id, inv);
    try {
      const value = await current.run(inv, () =>
        dispatch(m.method, m.payload, {
          sessionId: m.sessionId,
          projectRoot: m.projectRoot,
          invocationId: inv.id,
          signal: inv.controller.signal,
        })
      );
      transport.send({ t: 'res', id: m.id, ok: true, value });
    } catch (e) {
      transport.send({ t: 'res', id: m.id, ok: false, error: errorShape(e) });
    } finally {
      invocations.delete(inv.id);
    }
  };
  const onInit = async (m: Extract<MainToPluginHost, { t: 'init' }>) => {
    if (initialized) return;
    initialized = true;
    try {
      const module = await import(
        /* @vite-ignore */ pathToFileURL(join(m.pluginRoot, m.main)).href
      );
      if (typeof module.activate !== 'function') throw new Error('插件 main 未导出 activate');
      await module.activate(api(m.pluginId, m.dataDir));
      transport.send({
        t: 'ready',
        registered: {
          tools: [...tools.keys()],
          commands: [...commands.keys()],
          triggers: [...triggers.keys()],
          rendererMethods: [...renderer.keys()],
        },
      });
    } catch (e) {
      transport.send({ t: 'init-error', message: e instanceof Error ? e.message : String(e) });
    }
  };
  transport.onMessage((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const m = raw as MainToPluginHost;
    switch (m.t) {
      case 'init':
        void onInit(m);
        break;
      case 'call':
        void onCall(m);
        break;
      case 'cancel': {
        const inv = invocations.get(m.invocationId);
        if (!inv) return;
        inv.controller.abort();
        for (const [id, p] of pending)
          if (p.invocationId === inv.id) {
            pending.delete(id);
            p.reject(error('ABORTED', '调用已取消'));
          }
        break;
      }
      case 'res': {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        if (m.ok) p.resolve(m.value);
        else p.reject(error(m.error.code, m.error.message));
      }
    }
  });
}
