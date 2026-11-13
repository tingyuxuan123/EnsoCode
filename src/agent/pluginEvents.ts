import { randomUUID } from 'node:crypto';
import type {
  ExtensionAPI,
  InlineExtension,
  InputEventResult,
  ToolCallEventResult,
  ToolResultEventResult,
} from '@earendil-works/pi-coding-agent';
import {
  AGENT_END_TEXT_MAX,
  BEFORE_AGENT_START_APPEND_MAX,
  BEFORE_AGENT_START_PROMPT_MAX,
  CONTEXT_USAGE_BUCKETS,
  type ContextUsagePayload,
  isChildInterceptEvent,
  type PluginEventName,
  type PluginInterceptEvent,
} from '@shared/extensionPlugins/events';
import { PLUGIN_MESSAGE_TYPE, type PluginInjectImage } from '@shared/extensionPlugins/protocol';
import type { PluginEventPlan } from '@shared/extensionPlugins/types';
import type { ContextOccupancy, PluginInterceptRequest, TokenUsage } from '@shared/types/agent';

export const PLUGIN_COMPACT_TIMEOUT_MS = 12_000;
export const PLUGIN_INTERCEPT_TIMEOUT_MS = 30_000;
export const PLUGIN_CHILD_INTERCEPT_TIMEOUT_MS = 8_000;
export const TOOL_RESULT_OBSERVE_MAX_CHARS = 64 * 1024;
export type PluginSessionEmit =
  | { type: 'plugin-event'; event: PluginEventName; data: unknown }
  | ({ type: 'plugin-intercept'; requestId: string } & PluginInterceptRequest);
export interface PluginInjectMessage {
  pluginId: string;
  pluginName: string;
  text: string;
  images?: PluginInjectImage[];
  deliverAs: 'steer' | 'followUp' | 'nextTurn';
  triggerTurn: boolean;
}

export function contextUsagePayload(
  occupancy: ContextOccupancy,
  messages: ReadonlyArray<{ role?: string; usage?: TokenUsage }>
): ContextUsagePayload {
  const buckets = {} as ContextUsagePayload['buckets'];
  for (const id of CONTEXT_USAGE_BUCKETS) buckets[id] = occupancy.buckets[id];
  const usage = messages.findLast(
    (message) => message.role === 'assistant' && message.usage
  )?.usage;
  return {
    used: occupancy.used,
    estimated: occupancy.estimated,
    buckets,
    ...(occupancy.contextWindow !== undefined ? { contextWindow: occupancy.contextWindow } : {}),
    ...(occupancy.percent !== undefined ? { percent: occupancy.percent } : {}),
    ...(usage
      ? {
          usage: {
            input: usage.input,
            output: usage.output,
            cacheRead: usage.cacheRead,
            cacheWrite: usage.cacheWrite,
          },
        }
      : {}),
  };
}

/** Child tools are checked, but plugins cannot rewrite child input/results or inject turns. */
export function childPluginEventPlan(
  plan: PluginEventPlan | undefined
): PluginEventPlan | undefined {
  if (!plan) return undefined;
  const intercept = plan.intercept.filter((item) => isChildInterceptEvent(item.event));
  return plan.observe.length || intercept.length
    ? { observe: [...plan.observe], intercept, inject: false }
    : undefined;
}

export class PluginEventInvoker {
  private readonly pending = new Map<string, { settle(value: unknown): void }>();
  private sender: ExtensionAPI['sendMessage'] | undefined;
  constructor(
    readonly plan: PluginEventPlan,
    private readonly emit: (event: PluginSessionEmit) => void,
    private readonly options: {
      interceptTimeoutMs?: number;
      compactTimeoutMs?: number;
      childSession?: boolean;
    } = {}
  ) {}
  get childSession(): boolean {
    return this.options.childSession === true;
  }
  intercepts(event: PluginInterceptEvent): boolean {
    return (
      (!this.childSession || isChildInterceptEvent(event)) &&
      this.plan.intercept.some((item) => item.event === event)
    );
  }
  bindSender(sender: ExtensionAPI['sendMessage']): void {
    this.sender = sender;
  }
  notify(event: PluginEventName, data: unknown): void {
    try {
      this.emit({ type: 'plugin-event', event, data });
    } catch {
      /* Released session. */
    }
  }
  intercept<R extends PluginInterceptRequest>(
    event: R['event'],
    payload: R['payload']
  ): Promise<unknown> {
    const requestId = randomUUID();
    const timeoutMs =
      event === 'before_compact'
        ? (this.options.compactTimeoutMs ?? PLUGIN_COMPACT_TIMEOUT_MS)
        : (this.options.interceptTimeoutMs ??
          (this.childSession ? PLUGIN_CHILD_INTERCEPT_TIMEOUT_MS : PLUGIN_INTERCEPT_TIMEOUT_MS));
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve(value);
      };
      const timer = setTimeout(() => finish(undefined), timeoutMs);
      this.pending.set(requestId, { settle: finish });
      try {
        this.emit({ type: 'plugin-intercept', requestId, event, payload } as PluginSessionEmit);
      } catch {
        finish(undefined);
      }
    });
  }
  resolve(result: { requestId: string; ok: boolean; result?: unknown }): boolean {
    const entry = this.pending.get(result.requestId);
    if (!entry) return false;
    entry.settle(result.ok ? result.result : undefined);
    return true;
  }
  cancelAll(outcome?: unknown): void {
    const value =
      outcome ??
      (this.childSession
        ? { block: true, reason: '子会话已中断或关闭，插件检查未完成' }
        : undefined);
    for (const entry of [...this.pending.values()]) entry.settle(value);
  }
  deliver(message: PluginInjectMessage): { ok: true } | { ok: false; error: string } {
    if (this.childSession) return { ok: false, error: '会话未声明注入' };
    if (!this.sender) return { ok: false, error: '会话未就绪' };
    try {
      this.sender(
        {
          customType: PLUGIN_MESSAGE_TYPE,
          content: message.images?.length
            ? [
                { type: 'text', text: message.text },
                ...message.images.map((image) => ({ type: 'image' as const, ...image })),
              ]
            : message.text,
          display: true,
          details: { pluginId: message.pluginId, pluginName: message.pluginName },
        },
        { deliverAs: message.deliverAs, triggerTurn: message.triggerTurn }
      );
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  watchesTool(event: PluginInterceptEvent, toolName: string): boolean {
    const entry = this.plan.intercept.find((item) => item.event === event);
    return !!entry && (!entry.tools?.length || entry.tools.includes(toolName));
  }
  get pendingCount(): number {
    return this.pending.size;
  }
}

const textContent = (content: readonly { type?: string; text?: string }[]): string =>
  content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function createPluginEventsExtension(invoker: PluginEventInvoker): InlineExtension {
  const observe = new Set(invoker.plan.observe);
  return {
    name: 'enso-plugin-events',
    hidden: true,
    factory: (pi) => {
      invoker.bindSender((message, options) => pi.sendMessage(message, options));
      if (observe.has('session_start'))
        pi.on('session_start', (event) =>
          invoker.notify('session_start', { reason: event.reason })
        );
      if (observe.has('session_end'))
        pi.on('session_shutdown', (event) =>
          invoker.notify('session_end', { reason: event.reason })
        );
      if (observe.has('agent_start')) pi.on('agent_start', () => invoker.notify('agent_start', {}));
      if (observe.has('agent_end'))
        pi.on('agent_end', (event) => {
          const last = [...(event.messages ?? [])]
            .reverse()
            .find((message) => message.role === 'assistant');
          const content =
            last && 'content' in last && Array.isArray(last.content) ? last.content : [];
          invoker.notify('agent_end', { text: textContent(content).slice(0, AGENT_END_TEXT_MAX) });
        });
      if (observe.has('before_compact'))
        pi.on('session_before_compact', async (event) => {
          if (invoker.childSession) invoker.notify('before_compact', { reason: event.reason });
          else await invoker.intercept('before_compact', { reason: event.reason });
        });
      if (observe.has('after_compact'))
        pi.on('session_compact', (event) =>
          invoker.notify('after_compact', { reason: event.reason })
        );
      if (invoker.intercepts('tool_call') || observe.has('tool_call'))
        pi.on('tool_call', async (event) => {
          const input = event.input as Record<string, unknown>;
          let result: ToolCallEventResult | undefined;
          if (invoker.intercepts('tool_call') && invoker.watchesTool('tool_call', event.toolName)) {
            const raw = await invoker.intercept('tool_call', {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: { ...input },
            });
            if (record(raw)) {
              if (raw.block === true)
                result = {
                  block: true,
                  ...(typeof raw.reason === 'string' ? { reason: raw.reason } : {}),
                };
              else if (record(raw.input)) {
                for (const key of Object.keys(input)) delete input[key];
                Object.assign(input, raw.input);
              }
            }
          }
          if (observe.has('tool_call') && !result?.block)
            invoker.notify('tool_call', {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: { ...input },
            });
          return result;
        });
      if (invoker.intercepts('tool_result') || observe.has('tool_result'))
        pi.on('tool_result', async (event) => {
          let result: ToolResultEventResult | undefined;
          if (
            invoker.intercepts('tool_result') &&
            invoker.watchesTool('tool_result', event.toolName)
          ) {
            const raw = await invoker.intercept('tool_result', {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: event.input,
              content: textContent(event.content),
              isError: event.isError,
            });
            if (record(raw))
              result = {
                ...(typeof raw.content === 'string'
                  ? { content: [{ type: 'text', text: raw.content }] }
                  : {}),
                ...(typeof raw.isError === 'boolean' ? { isError: raw.isError } : {}),
              };
          }
          if (observe.has('tool_result'))
            invoker.notify('tool_result', {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: event.input,
              content: textContent(result?.content ?? event.content).slice(
                0,
                TOOL_RESULT_OBSERVE_MAX_CHARS
              ),
              isError: result?.isError ?? event.isError,
            });
          return result;
        });
      if (invoker.intercepts('input') || observe.has('input'))
        pi.on('input', async (event) => {
          if (event.source === 'extension') return;
          let result: InputEventResult | undefined;
          if (invoker.intercepts('input')) {
            const raw = await invoker.intercept('input', {
              text: event.text,
              source: event.source,
            });
            if (record(raw)) {
              if (raw.action === 'handled') result = { action: 'handled' };
              else if (raw.action === 'transform' && typeof raw.text === 'string')
                result = {
                  action: 'transform',
                  text: raw.text,
                  ...(event.images ? { images: event.images } : {}),
                };
            }
          }
          if (observe.has('input') && result?.action !== 'handled')
            invoker.notify('input', {
              text: result?.action === 'transform' ? result.text : event.text,
              source: event.source,
            });
          return result;
        });
      if (observe.has('model_select'))
        pi.on('model_select', (event) =>
          invoker.notify('model_select', {
            provider: event.model.provider,
            modelId: event.model.id,
            ...(event.previousModel
              ? {
                  previous: {
                    provider: event.previousModel.provider,
                    modelId: event.previousModel.id,
                  },
                }
              : {}),
            source: event.source,
          })
        );
      if (
        !invoker.childSession &&
        (invoker.intercepts('before_agent_start') || observe.has('before_agent_start'))
      )
        pi.on('before_agent_start', async (event) => {
          const payload = {
            prompt:
              event.messageType === 'user'
                ? event.prompt.slice(0, BEFORE_AGENT_START_PROMPT_MAX)
                : '',
            kind: event.messageType,
          };
          const raw = invoker.intercepts('before_agent_start')
            ? await invoker.intercept('before_agent_start', payload)
            : undefined;
          const append =
            record(raw) && typeof raw.append === 'string'
              ? raw.append.slice(0, BEFORE_AGENT_START_APPEND_MAX)
              : '';
          if (observe.has('before_agent_start')) invoker.notify('before_agent_start', payload);
          return append ? { systemPrompt: `${event.systemPrompt}\n\n${append}` } : undefined;
        });
    },
  };
}
