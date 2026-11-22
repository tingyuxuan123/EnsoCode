import type { SessionIdentity } from '@shared/types/agent';
import {
  HOT_BUILTIN_TOOL_IDS,
  projectDisabledBuiltinTools,
  resolveDisabledBuiltinTools,
} from '@shared/types/builtinTools';

type ToolSettings =
  | { disabledBuiltinTools?: unknown; projects?: unknown; memoryDistillEnabled?: unknown }
  | undefined;
const canonical = (ids: readonly string[]) => [...new Set(ids)].sort();
const hot = new Set<string>(HOT_BUILTIN_TOOL_IDS);

export function sessionDisabledTools(
  state: ToolSettings,
  projectId: string | undefined,
  extra: readonly string[],
  computerSupported: boolean
): string[] {
  return canonical([
    ...resolveDisabledBuiltinTools(state?.disabledBuiltinTools, {
      disabledBuiltinTools: projectDisabledBuiltinTools(state?.projects, projectId),
    }),
    ...extra,
    ...(!computerSupported ? ['computer'] : []),
  ]);
}

interface Scope {
  identity: SessionIdentity;
  projectId?: string;
  extra: readonly string[];
  spawnDisabled: readonly string[];
  /** 会话确实来自本机普通项目（远程 / Bot / 子会话为 false） */
  memoryReviewSupported: boolean;
  /** 已下发的收口开关；undefined 表示本次连接还没发过 */
  sentMemoryReview?: boolean;
  sent: string;
}

/** 下发给 worker 的有效禁用表：spawn 期固定的（非热更新）部分 + 当前按设置重算的热更新部分。 */
function scopeDisabledTools(
  scope: Scope,
  state: ToolSettings,
  computerSupported: boolean
): string[] {
  return canonical([
    ...scope.spawnDisabled,
    ...sessionDisabledTools(state, scope.projectId, scope.extra, computerSupported).filter((id) =>
      hot.has(id)
    ),
  ]);
}

/** Parent sessions only: project/global settings never lift fixed session restrictions. */
export class BuiltinToolScopes {
  private readonly scopes = new Map<string, Scope>();

  remember(
    identity: SessionIdentity,
    projectId: string | undefined,
    extra: readonly string[],
    disabled: readonly string[],
    memoryReviewSupported = false
  ): boolean {
    const existing = this.scopes.get(identity.sessionId);
    if (existing?.identity.generation === identity.generation) {
      // 同代重进（resume）也要刷新资格，否则项目会话会沿用上次的判断。
      existing.memoryReviewSupported = memoryReviewSupported;
      return false;
    }
    this.scopes.set(identity.sessionId, {
      identity: { ...identity },
      projectId,
      extra: [...extra],
      spawnDisabled: disabled.filter((id) => !hot.has(id)),
      memoryReviewSupported,
      sent: JSON.stringify(canonical(disabled)),
    });
    return true;
  }

  forget(sessionId: string): void {
    this.scopes.delete(sessionId);
  }
  clear(): void {
    this.scopes.clear();
  }
  has(identity: SessionIdentity): boolean {
    return this.scopes.get(identity.sessionId)?.identity.generation === identity.generation;
  }

  changes(
    state: ToolSettings,
    computerSupported: boolean
  ): Array<{ identity: SessionIdentity; disabledTools: string[] }> {
    const out: Array<{ identity: SessionIdentity; disabledTools: string[] }> = [];
    for (const scope of this.scopes.values()) {
      const disabledTools = scopeDisabledTools(scope, state, computerSupported);
      const key = JSON.stringify(disabledTools);
      if (key === scope.sent) continue;
      scope.sent = key;
      out.push({ identity: scope.identity, disabledTools });
    }
    return out;
  }

  /**
   * 当轮记忆收口的开关快照：项目资格 + 自动整理开关 + 当前有效禁用工具。
   * 必须单独给，不能塞进 changes() 的载荷，否则旧客户端会因多出的键被判非法。
   */
  memoryTurnReviewUpdates(
    state: ToolSettings,
    computerSupported: boolean
  ): Array<{ identity: SessionIdentity; disabledTools: string[]; memoryTurnReview: boolean }> {
    const out: Array<{
      identity: SessionIdentity;
      disabledTools: string[];
      memoryTurnReview: boolean;
    }> = [];
    for (const scope of this.scopes.values()) {
      const disabledTools = scopeDisabledTools(scope, state, computerSupported);
      const memoryTurnReview =
        scope.memoryReviewSupported &&
        state?.memoryDistillEnabled !== false &&
        !disabledTools.includes('memory');
      if (scope.sentMemoryReview === memoryTurnReview) continue;
      // 默认就是关闭：从没开过的会话不必多带一个键去改协议形状。
      if (memoryTurnReview === false && scope.sentMemoryReview === undefined) {
        scope.sentMemoryReview = false;
        continue;
      }
      scope.sentMemoryReview = memoryTurnReview;
      out.push({ identity: scope.identity, disabledTools, memoryTurnReview });
    }
    return out;
  }
}
