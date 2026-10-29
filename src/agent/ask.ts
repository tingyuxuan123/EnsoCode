import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { ASK_TIMEOUT_ERROR } from '@shared/humanRequestTimeout';
import type { AskRequestInfo } from '@shared/types/agent';

interface PendingAsk {
  info: AskRequestInfo;
  resolve(answer: string): void;
  reject(error: Error): void;
  expire(): void;
}

let counter = 0;

/** agent → 用户提问的挂起管理(与 ApprovalGate 同构:请求经事件上抛,答复经命令回落) */
export class AskManager {
  private readonly pending = new Map<string, PendingAsk>();

  constructor(
    // biome-ignore lint/suspicious/noConfusingVoidType: existing event callbacks may return void; only false rejects dispatch.
    private readonly onRequest: (info: AskRequestInfo) => boolean | void,
    private readonly onResolved: (requestId: string) => void,
    /** 等真人回答的时限：提问带 expiresAt，由 Main 到期发 request-timeout */
    readonly humanTimeoutMs?: number
  ) {}

  ask(
    question: string,
    options?: string[],
    opts: {
      signal?: AbortSignal;
      timeoutMs?: number;
      defaultAnswer?: string;
      /** Internal: strict ExtensionUI selection, never a free-form/default answer. */
      selectionOnly?: boolean;
      /** 宿主内部跟踪已成功发出的选择；不暴露给模型或 IPC。 */
      onRequestId?: (requestId: string) => void;
    } = {}
  ): Promise<string> {
    if (opts.signal?.aborted) return Promise.reject(new Error('question cancelled'));
    const timeoutMs =
      typeof opts.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
        ? opts.timeoutMs
        : undefined;
    const expiresIn = timeoutMs
      ? Math.min(timeoutMs, this.humanTimeoutMs || Number.POSITIVE_INFINITY)
      : this.humanTimeoutMs;
    const requestId = `ask-${++counter}-${Date.now().toString(36)}`;
    const info: AskRequestInfo = {
      requestId,
      question,
      ...(options && options.length > 0 ? { options } : {}),
      ...(opts.selectionOnly ? { selectionOnly: true } : {}),
      ...(expiresIn ? { expiresAt: Date.now() + expiresIn } : {}),
    };
    return new Promise<string>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        this.pending.delete(requestId);
        fn();
        this.onResolved(requestId);
      };
      const onAbort = () => settle(() => reject(new Error('question cancelled')));
      this.pending.set(requestId, {
        info,
        resolve: (answer) => settle(() => resolve(answer)),
        reject: (error) => settle(() => reject(error)),
        expire: () => {
          settle(() =>
            !opts.selectionOnly && opts.defaultAnswer
              ? resolve(`${opts.defaultAnswer} (auto-selected: no response in 10 minutes)`)
              : reject(new Error(ASK_TIMEOUT_ERROR))
          );
        },
      });
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      // 超时:有默认答案则视为选中(无人值守不永久卡死),否则取消
      if (timeoutMs) {
        timer = setTimeout(() => {
          settle(() =>
            !opts.selectionOnly && opts.defaultAnswer
              ? resolve(`${opts.defaultAnswer} (auto-selected: no response in time)`)
              : reject(new Error('question timed out'))
          );
        }, timeoutMs);
      }
      try {
        if (this.onRequest(info) === false) onAbort();
        else if (!settled) opts.onRequestId?.(requestId);
      } catch (error) {
        settle(() => reject(error));
      }
    });
  }

  async select(
    question: string,
    options: string[],
    opts: {
      signal?: AbortSignal;
      timeoutMs?: number;
      onRequestId?: (requestId: string) => void;
    } = {}
  ): Promise<string | undefined> {
    try {
      if (
        typeof question !== 'string' ||
        !question.trim() ||
        !Array.isArray(options) ||
        options.length === 0 ||
        options.some((option) => typeof option !== 'string' || !option.trim()) ||
        new Set(options).size !== options.length
      ) {
        throw new Error('question and distinct non-empty options are required');
      }
      const choices = [...options];
      const answer = await this.ask(question, choices, { ...opts, selectionOnly: true });
      return choices.includes(answer) ? answer : undefined;
    } catch {
      return undefined;
    }
  }

  respond(requestId: string, answer: string): boolean {
    const entry = this.pending.get(requestId);
    if (!entry || typeof answer !== 'string') return false;
    if (
      entry.info.selectionOnly &&
      entry.info.expiresAt !== undefined &&
      Date.now() >= entry.info.expiresAt
    ) {
      entry.expire();
      return false;
    }
    if (!entry.info.selectionOnly && !answer.trim()) return false;
    entry.resolve(answer);
    return true;
  }

  /** Main 判定等人超时：按未回答收尾 */
  expire(requestId: string): void {
    this.pending.get(requestId)?.expire();
  }

  /** abort/dismiss 时取消全部挂起提问(fail-closed) */
  cancelAll(): void {
    for (const entry of this.pending.values()) {
      entry.reject(new Error('question cancelled'));
    }
    this.pending.clear();
  }

  snapshot(): AskRequestInfo[] {
    return [...this.pending.values()].map((entry) => entry.info);
  }
}

/** ask_user 工具:向用户提问并阻塞等答复(决策真正属于用户时才用) */
export function createAskTool(manager: AskManager): ToolDefinition {
  return {
    name: 'ask_user',
    label: 'Ask user',
    description:
      'Ask the user a question and wait for their answer. Use ONLY when a decision genuinely ' +
      'belongs to the user (ambiguous requirements, irreversible choices, preferences you cannot ' +
      'infer) — not for confirmations you can resolve yourself. Provide 2-4 short options when ' +
      'the choices are enumerable; the user can always type a free-form answer instead. ' +
      'For unattended/long-running work, pass timeout_seconds + default_option so it does not block forever.',
    promptSnippet:
      'ask_user: ask the user a question and block until answered — only for decisions that are ' +
      'genuinely theirs (ambiguity, irreversible choices, preferences); offer 2-4 options when enumerable',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question, clear and specific' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional 2-4 short quick-pick options',
        },
        timeout_seconds: {
          type: 'number',
          description:
            'Optional: auto-resolve after N seconds (use with default_option for unattended runs)',
        },
        default_option: {
          type: 'string',
          description: 'Optional: answer to auto-select when the timeout elapses',
        },
      },
      required: ['question'],
    } as unknown as ToolDefinition['parameters'],
    async execute(_toolCallId, params, signal) {
      const {
        question = '',
        options,
        timeout_seconds: timeoutSeconds,
        default_option: defaultOption,
      } = params as {
        question?: string;
        options?: string[];
        timeout_seconds?: number;
        default_option?: string;
      };
      if (!question.trim()) throw new Error('question is required');
      const answer = await manager.ask(question.trim(), options?.slice(0, 4), {
        signal,
        ...(typeof timeoutSeconds === 'number' && timeoutSeconds > 0
          ? { timeoutMs: timeoutSeconds * 1000 }
          : {}),
        ...(defaultOption ? { defaultAnswer: defaultOption } : {}),
      });
      return { content: [{ type: 'text' as const, text: answer }], details: undefined };
    },
  };
}
