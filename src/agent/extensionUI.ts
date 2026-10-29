import { realpathSync } from 'node:fs';
import type {
  ExtensionRunner,
  ExtensionUIDialogOptions,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { ApprovalMode } from '@shared/types/agent';
import type { AskManager } from './ask';

interface LcuApprovalPolicy {
  approvalMode(): ApprovalMode;
  lcuExtensionPath: string;
  getToolDefinition?(name: string): ToolDefinition | undefined;
  requiresConfirmation?(): boolean;
}

export interface ExtensionUIBridge {
  prepareTool(toolName: string): void;
  approvalModeChanged(): void;
}

/** LCU 0.13 原生应用许可的完整形状；不把网页、录音或普通问题当应用授权。 */
function isLcuAppApproval(title: string, choices: string[]): boolean {
  if (!/^Allow Computer Use to use "[^"\r\n]+"\?$/.test(title)) return false;
  const expected = ['Allow once', 'Allow for this session', 'Always allow', 'Decline'];
  const valid = [
    [expected[0], expected[3]],
    [expected[0], expected[1], expected[3]],
    [expected[0], expected[2], expected[3]],
    expected,
  ];
  return valid.some(
    (options) =>
      options.length === choices.length && options.every((value, index) => value === choices[index])
  );
}

function sameFile(left: string, right: string): boolean {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return false;
  }
}

/**
 * 只接 Pi 扩展的协议式选择/确认，不调用 bindExtensions：后者还会触发 session_start
 * 和资源发现，Enso 的 Claude hooks 已由现有生命周期管理，不能在这里重跑。
 * 其余终端 UI 保持 SDK 的 no-op；不声称支持 custom/editor/picker。
 */
export function bindExtensionUI(
  runner: Pick<ExtensionRunner, 'getUIContext' | 'setUIContext'> &
    Partial<Pick<ExtensionRunner, 'getAllRegisteredTools'>>,
  asks: AskManager,
  isCurrent: () => boolean,
  policy?: LcuApprovalPolicy
): ExtensionUIBridge {
  const wrapped = new WeakSet<ToolDefinition>();
  const pendingApps = new Map<string, () => void>();
  // LCU 并行调用共享 approvalContext，回包可能经由已结束的最后一次调用 ctx。
  // 同一批活调用共享许可生命期；最后一个调用结束/取消后整批失效，不让旧 ctx 借用下一批。
  let activity = { lifetime: new AbortController(), calls: new Set<AbortSignal>() };
  const isFull = () => policy?.approvalMode() === 'full' && !policy.requiresConfirmation?.();
  const select = async (
    title: string,
    options: string[],
    opts?: ExtensionUIDialogOptions,
    mayAutoApprove?: () => boolean
  ): Promise<string | undefined> => {
    if (!isCurrent() || opts?.signal?.aborted) return undefined;
    let requestId: string | undefined;
    let autoSelected = false;
    try {
      const answer = await asks.select(title, options, {
        signal: opts?.signal,
        timeoutMs: opts?.timeout,
        ...(mayAutoApprove
          ? {
              onRequestId: (id: string) => {
                requestId = id;
                const tryAutoApprove = () => {
                  if (mayAutoApprove())
                    autoSelected = asks.respond(id, 'Allow once') || autoSelected;
                };
                pendingApps.set(id, tryAutoApprove);
                tryAutoApprove();
              },
            }
          : {}),
      });
      // 答复与会话释放可能发生在同一轮事件循环；过期会话不能采纳迟到授权。
      return isCurrent() && !opts?.signal?.aborted && (!autoSelected || mayAutoApprove?.())
        ? answer
        : undefined;
    } catch {
      return undefined;
    } finally {
      if (requestId !== undefined) pendingApps.delete(requestId);
    }
  };
  runner.setUIContext(
    {
      ...runner.getUIContext(),
      select: (title, options, opts) => select(title, options, opts),
      confirm: async (title, message, opts) =>
        (await select(`${title}\n\n${message}`, ['Allow', 'Deny'], opts)) === 'Allow',
    },
    'rpc'
  );
  return {
    approvalModeChanged() {
      for (const tryAutoApprove of pendingApps.values()) tryAutoApprove();
    },
    prepareTool(toolName) {
      if (!policy || !['js', 'js_reset'].includes(toolName)) return;
      const registered = runner
        .getAllRegisteredTools?.()
        .find((tool) => tool.definition.name === toolName);
      if (!registered || !sameFile(registered.sourceInfo.path, policy.lcuExtensionPath)) return;
      const definition = registered.definition;
      if (definition.label !== `LCU ${toolName}` || wrapped.has(definition)) return;
      if (policy.getToolDefinition && policy.getToolDefinition(toolName) !== definition) return;
      wrapped.add(definition);
      const execute = definition.execute;
      // Pi 1.0 的工具 wrapper 在执行时读取 definition.execute。只包可信工具的 ctx，
      // 不用全局“当前工具名”或 AsyncLocalStorage：MCP 回包由独立 stdio 异步上下文派发。
      definition.execute = async (id, params, signal, onUpdate, context) => {
        if (!context) return execute.call(definition, id, params, signal, onUpdate, context);
        if (activity.lifetime.signal.aborted) {
          activity = { lifetime: new AbortController(), calls: new Set<AbortSignal>() };
        }
        const group = activity;
        const callLifetime = new AbortController();
        const callSignal = signal
          ? AbortSignal.any([callLifetime.signal, signal])
          : callLifetime.signal;
        group.calls.add(callSignal);
        const leave = () => {
          group.calls.delete(callSignal);
          if (group.calls.size === 0) group.lifetime.abort();
        };
        callSignal.addEventListener('abort', leave, { once: true });
        if (callSignal.aborted) leave();
        const trustedSelect = async (
          title: string,
          options: string[],
          opts?: ExtensionUIDialogOptions
        ) => {
          const signals = [group.lifetime.signal, opts?.signal].filter(
            (value): value is AbortSignal => value !== undefined
          );
          const combined = AbortSignal.any(signals);
          const live = () => isCurrent() && !combined.aborted;
          if (!live()) return undefined;
          const mayAutoApprove = () => live() && isFull() && isLcuAppApproval(title, options);
          if (mayAutoApprove()) {
            await Promise.resolve();
            if (!live()) return undefined;
            if (mayAutoApprove()) return 'Allow once';
          }
          return select(
            title,
            options,
            { ...opts, signal: combined },
            isLcuAppApproval(title, options) ? mayAutoApprove : undefined
          );
        };
        const ui = new Proxy({} as typeof context.ui, {
          get(_target, key) {
            const original = context.ui;
            if (key === 'select') return trustedSelect;
            const value = Reflect.get(original, key, original);
            return typeof value === 'function' ? value.bind(original) : value;
          },
        });
        const scoped = new Proxy(context, {
          get(target, key) {
            return key === 'ui' ? ui : Reflect.get(target, key, target);
          },
        });
        try {
          return await execute.call(definition, id, params, signal, onUpdate, scoped);
        } finally {
          callLifetime.abort();
          callSignal.removeEventListener('abort', leave);
        }
      };
    },
  };
}
