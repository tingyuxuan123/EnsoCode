import type {
  DesignHookEvent,
  DesignToolRequestEvent,
  DesignToolResult,
} from '@shared/types/design';
import { designHooks, designTools, updateDesignUi } from './host/registry';
import { toDesignToolResult } from './host/results';
import type { PluginContext } from './host/types';
import type { PluginAgentHandlerContext, PluginCodingAgentHookEvent } from './vetta/sdk/agent';

export async function dispatchDesignTool(
  request: DesignToolRequestEvent,
  signal: AbortSignal,
  ctx: PluginContext
): Promise<DesignToolResult> {
  signal.throwIfAborted();
  const tool = designTools.get(request.tool);
  if (!tool) throw new Error(`Design tool not registered: ${request.tool}`);
  const context: PluginAgentHandlerContext<any> & { signal: AbortSignal } = {
    invocationId: request.requestId,
    plugin: { id: ctx.plugin?.id ?? 'vetta-ui-design', contributionId: tool.id },
    session: { id: request.session.sessionId, cwd: request.session.cwd, scenario: 'conversation' },
    model: { provider: '', id: '', api: '', input: [] },
    conversation: { messages: [], messageCount: 0 },
    runtime: {
      activeToolNames: [...designTools.keys()],
      availableToolNames: [...designTools.keys()],
      runIndex: 0,
    },
    trigger: {
      kind: 'tool-call',
      timestamp: Date.now(),
      toolCallId: request.requestId,
      toolId: tool.id,
      toolName: request.tool,
      input: request.params,
    },
    signal,
    host: { fs: ctx.fs, conversation: ctx.conversation },
    actions: {
      tools: {
        setEnabled: (name, enabled) => updateDesignUi(`tool:${name}`, enabled),
        enable: (name) => updateDesignUi(`tool:${name}`, true),
        disable: (name) => updateDesignUi(`tool:${name}`, false),
      },
      systemPrompt: {
        addBlock: (block) => updateDesignUi(`prompt:${block.id}`, block),
        replaceBlock: (id, block) => updateDesignUi(`prompt:${id}`, block),
        updateBlock: (id, patch) => updateDesignUi(`prompt:${id}`, patch),
        removeBlock: (id) => updateDesignUi(`prompt:${id}`, null),
        setBlockEnabled: (id, enabled) => updateDesignUi(`promptEnabled:${id}`, enabled),
      },
      continuation: { request: (result) => updateDesignUi('continuation', result) },
    },
  };
  // Upstream has no AbortSignal in its public signature. Extra signal permits
  // cooperative handlers; race ensures a cancelled invocation cannot respond success.
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () =>
      reject(signal.reason ?? new DOMException('Design tool cancelled', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => tool.handler(context)),
      aborted,
    ]);
    signal.throwIfAborted();
    return toDesignToolResult(result);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

export async function dispatchDesignHook(
  input: DesignHookEvent,
  ctx: PluginContext
): Promise<void> {
  const base = {
    sessionId: input.sessionId,
    cwd: input.cwd,
    model: '',
    permissionMode: 'default' as const,
  };
  const event: PluginCodingAgentHookEvent =
    input.event === 'prompt-submit'
      ? {
          ...base,
          eventName: 'UserPromptSubmit',
          turnId: input.sessionId,
          prompt: input.prompt ?? '',
        }
      : input.event === 'stop'
        ? {
            ...base,
            eventName: 'Stop',
            turnId: input.sessionId,
            stopHookActive: false,
            lastAssistantMessage: null,
          }
        : { ...base, eventName: 'SessionEnd', cause: 'dispose' };
  for (const hook of designHooks.values()) {
    if (hook.eventName !== event.eventName) continue;
    await hook.handler({
      invocationId: crypto.randomUUID(),
      plugin: { id: ctx.plugin.id, contributionId: hook.id },
      session: { id: input.sessionId, cwd: input.cwd, scenario: 'conversation' },
      event,
      host: { fs: ctx.fs, conversation: ctx.conversation },
    });
  }
}
