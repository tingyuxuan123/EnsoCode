import { validateToolArguments } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { ApprovalReviewRecord } from '@shared/approvalReviewRecord';
import type {
  AgentCommand,
  AgentWorkerEvent,
  McpServerSpawnConfig,
  SessionIdentity,
} from '@shared/types/agent';
import { type ApprovalGate, summarizeApproval, throwUnlessAllowed } from './approval';
import { approvalReviewArguments, computeApprovalActionHash } from './approvalReview';
import { rememberApprovalReview, takeApprovalReview } from './approvalReviewRecords';
import { classifyProtectedTool } from './protectedActions';

export type PluginMcpCommand = Extract<
  AgentCommand,
  { type: 'plugin-mcp-list' | 'plugin-mcp-call' | 'plugin-mcp-cancel' }
>;
type Session = {
  gate: ApprovalGate;
  planning: () => boolean;
  recordScope?: string;
  review?: (tool: string, record: ApprovalReviewRecord) => void;
};
const key = (identity: SessionIdentity, requestId: string) =>
  JSON.stringify([identity.sessionId, identity.generation, requestId]);
const aborted = () => Object.assign(new Error('Plugin MCP call aborted'), { name: 'AbortError' });
const cancelable = <T>(work: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    const cancel = () => {
      signal.removeEventListener('abort', cancel);
      reject(aborted());
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    work.then(
      (value) => {
        signal.removeEventListener('abort', cancel);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', cancel);
        reject(error);
      }
    );
  });

/** No plugin-supplied names or descriptions can authorize the inner MCP action. */
export class PluginMcpGateway {
  private readonly pending = new Map<
    string,
    { identity: SessionIdentity; controller: AbortController }
  >();
  constructor(
    private readonly deps: {
      session: (identity: SessionIdentity) => Session | null;
      tools: (server: McpServerSpawnConfig) => Promise<ToolDefinition[]>;
      emit: (event: AgentWorkerEvent) => void;
    }
  ) {}

  handle(command: PluginMcpCommand): void {
    const id = key(command.identity, command.requestId);
    if (command.type === 'plugin-mcp-cancel') {
      this.pending.get(id)?.controller.abort();
      return;
    }
    if (this.pending.has(id)) return;
    const controller = new AbortController();
    this.pending.set(id, { identity: command.identity, controller });
    const timer = setTimeout(() => controller.abort(), 120_000);
    const finish = (outcome: { ok: true; value: unknown } | { ok: false; error: string }) => {
      this.deps.emit({
        type: 'plugin-mcp-result',
        identity: command.identity,
        requestId: command.requestId,
        ...outcome,
      });
    };
    void cancelable(this.run(command, controller.signal), controller.signal)
      .then(
        (value) => finish({ ok: true, value }),
        (error) =>
          finish({
            ok: false,
            error: error instanceof Error ? error.message : 'Plugin MCP call failed',
          })
      )
      .finally(() => {
        clearTimeout(timer);
        this.pending.delete(id);
      });
  }

  private session(identity: SessionIdentity, signal: AbortSignal): Session {
    if (signal.aborted) throw aborted();
    const session = this.deps.session(identity);
    if (!session) throw new Error('Plugin MCP session is unavailable or stale');
    if (session.planning()) throw new Error('Plan mode is active: plugin MCP calls are disabled');
    return session;
  }

  private async run(
    command: Exclude<PluginMcpCommand, { type: 'plugin-mcp-cancel' }>,
    signal: AbortSignal
  ): Promise<unknown> {
    const owner = this.session(command.identity, signal);
    const revision = owner.gate.revision;
    if (command.type === 'plugin-mcp-list') {
      const result = [];
      for (const server of command.servers) {
        const tools = await this.deps.tools(server).catch(() => []);
        this.session(command.identity, signal);
        for (const tool of tools) {
          const prefix = `${server.name}: `;
          if (tool.label.startsWith(prefix))
            result.push({
              server: server.name,
              name: tool.label.slice(prefix.length),
              description: tool.description,
            });
        }
      }
      return result;
    }
    const server = command.servers.find((item) => item.name === command.server);
    if (!server) throw new Error('Plugin MCP server is not enabled');
    const tools = await this.deps.tools(server);
    this.session(command.identity, signal);
    const definition = tools.find((tool) => tool.label === `${server.name}: ${command.tool}`);
    if (!definition) throw new Error('Plugin MCP tool is not available');
    const params = definition.prepareArguments
      ? definition.prepareArguments(command.args)
      : command.args;
    const callId = `plugin-mcp-${command.requestId}`;
    const validated = validateToolArguments(definition, {
      type: 'toolCall',
      id: callId,
      name: definition.name,
      arguments: params,
    } as never) as Record<string, unknown>;
    const category = owner.gate.protectedFloor
      ? classifyProtectedTool(command.tool, 'mcp', validated)
      : null;
    let allowReview: ApprovalReviewRecord | undefined;
    try {
      if (category || owner.gate.needsApproval('mcp', definition.name)) {
        throwUnlessAllowed(
          await owner.gate.ask(
            definition.name,
            'mcp',
            summarizeApproval('mcp', validated, command.tool),
            signal,
            callId,
            undefined,
            category ?? undefined,
            {
              recordScope: owner.recordScope,
              argumentsHash: computeApprovalActionHash(validated),
              exactArguments: approvalReviewArguments(validated),
              onAllowReview: (record) => {
                allowReview = record;
              },
              isCurrent: () =>
                this.deps.session(command.identity)?.gate === owner.gate && !owner.planning(),
            }
          )
        );
      }
      if (
        this.session(command.identity, signal).gate !== owner.gate ||
        owner.gate.revision !== revision
      )
        throw new Error('Plugin MCP owner or approval changed');
      if (allowReview && owner.recordScope)
        rememberApprovalReview(owner.recordScope, callId, allowReview);
      const result = await definition.execute(
        callId,
        validated,
        signal,
        undefined,
        undefined as never
      );
      this.session(command.identity, signal);
      return {
        content: result.content
          .flatMap((part) => (part.type === 'text' ? [part.text] : []))
          .join('\n'),
        isError: (result as { isError?: boolean }).isError === true,
      };
    } finally {
      if (owner.recordScope) {
        const record = takeApprovalReview(owner.recordScope, callId);
        if (record) owner.review?.(definition.name, record);
      }
    }
  }
  cancelSession(identity: SessionIdentity): void {
    for (const pending of this.pending.values())
      if (
        pending.identity.sessionId === identity.sessionId &&
        pending.identity.generation === identity.generation
      )
        pending.controller.abort();
  }
  close(): void {
    for (const entry of this.pending.values()) entry.controller.abort();
  }
}
