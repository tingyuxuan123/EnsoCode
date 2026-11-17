import { Agent, type AgentTool, type StreamFn } from '@earendil-works/pi-agent-core';
import {
  type Api,
  type AssistantMessage,
  getCurrentTools,
  type Message,
  type Model,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { CODEMODE_FORBIDDEN_TOOLS, CODEMODE_TOOL_NAME, prepareCodemodeInput } from './codemode';

export interface PluginForkBase {
  model: Model<Api>;
  messages: Message[];
  options?: SimpleStreamOptions;
  stream: StreamFn;
  reply?: AssistantMessage;
}

const READ_TOOLS = new Set(['read', 'grep', 'find', 'ls']);

/** Declared write tools preserve the cached prefix, but are never executable. */
export function forkRunnable(
  child: Pick<AgentSession, 'agent' | 'getCallableToolNames'>
): Set<string> {
  const names = new Set(child.agent.state.tools.map((tool) => tool.name));
  const allowed = new Set([...READ_TOOLS].filter((name) => names.has(name)));
  if (
    names.has(CODEMODE_TOOL_NAME) &&
    child
      .getCallableToolNames()
      .every((name) => READ_TOOLS.has(name) || CODEMODE_FORBIDDEN_TOOLS.has(name))
  )
    allowed.add(CODEMODE_TOOL_NAME);
  return allowed;
}

export function forkPluginAgent(
  base: PluginForkBase,
  child: AgentSession,
  thinkingLevel: Agent['state']['thinkingLevel']
): Agent & { runnable: Set<string> } {
  const allowed = forkRunnable(child);
  const runnable = new Map(
    child.agent.state.tools
      .filter((tool) => allowed.has(tool.name))
      .map((tool) => [tool.name, tool])
  );
  const tools: AgentTool[] = getCurrentTools(base.messages).map((declaration) => {
    const impl = runnable.get(declaration.name);
    return {
      ...declaration,
      label: impl?.label ?? declaration.name,
      ...(impl?.prepareArguments ? { prepareArguments: impl.prepareArguments } : {}),
      execute: impl
        ? impl.execute.bind(impl)
        : async () => {
            throw new Error(`只读分叉里不能用 ${declaration.name}`);
          },
    };
  });
  const reply = base.reply;
  const settled =
    reply?.stopReason === 'stop' && !reply.content.some((part) => part.type === 'toolCall');
  const agent = new Agent({
    initialState: {
      model: base.model,
      thinkingLevel,
      tools,
      messages: settled ? [...base.messages, reply] : [...base.messages],
    },
    streamFn: (_model, context, options) =>
      base.stream(base.model, context, { ...base.options, signal: options?.signal }),
    ...(base.options?.sessionId ? { sessionId: base.options.sessionId } : {}),
    beforeToolCall: async ({ toolCall, assistantMessage, args }) => {
      if (!runnable.has(toolCall.name))
        return {
          block: true,
          reason: `只读分叉里不能用 ${toolCall.name}，只能用 ${[...runnable.keys()].join(' / ')}`,
        };
      if (toolCall.name !== CODEMODE_TOOL_NAME) return undefined;
      const blocked = prepareCodemodeInput(args as Record<string, unknown>);
      if (blocked) return blocked;
      // Nested codemode tools must find their originating call in the child session.
      child.agent.state.messages = [...child.agent.state.messages, assistantMessage];
      return undefined;
    },
  });
  return Object.assign(agent, { runnable: new Set(runnable.keys()) });
}

export function pluginAgentText(message: { content?: unknown }): string {
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        part !== null &&
        typeof part === 'object' &&
        part.type === 'text' &&
        typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join('')
    .trim();
}
