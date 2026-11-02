import type { SessionIdentity } from '@shared/types/agent';
import {
  HOT_BUILTIN_TOOL_IDS,
  projectDisabledBuiltinTools,
  resolveDisabledBuiltinTools,
} from '@shared/types/builtinTools';

type ToolSettings = { disabledBuiltinTools?: unknown; projects?: unknown } | undefined;
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
  sent: string;
}

/** Parent sessions only: project/global settings never lift fixed session restrictions. */
export class BuiltinToolScopes {
  private readonly scopes = new Map<string, Scope>();

  remember(
    identity: SessionIdentity,
    projectId: string | undefined,
    extra: readonly string[],
    disabled: readonly string[]
  ): boolean {
    if (this.scopes.get(identity.sessionId)?.identity.generation === identity.generation)
      return false;
    this.scopes.set(identity.sessionId, {
      identity: { ...identity },
      projectId,
      extra: [...extra],
      spawnDisabled: disabled.filter((id) => !hot.has(id)),
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
      const disabledTools = canonical([
        ...scope.spawnDisabled,
        ...sessionDisabledTools(state, scope.projectId, scope.extra, computerSupported).filter(
          (id) => hot.has(id)
        ),
      ]);
      const key = JSON.stringify(disabledTools);
      if (key === scope.sent) continue;
      scope.sent = key;
      out.push({ identity: scope.identity, disabledTools });
    }
    return out;
  }
}
