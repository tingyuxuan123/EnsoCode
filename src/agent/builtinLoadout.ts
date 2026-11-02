import { HOT_BUILTIN_TOOL_IDS } from '@shared/types/builtinTools';

export { HOT_BUILTIN_TOOL_IDS };

export function enabledHotBuiltins(disabled: readonly string[]): Set<string> {
  const off = new Set(disabled);
  return new Set(
    HOT_BUILTIN_TOOL_IDS.filter((id) => !off.has(id) && (id !== 'workflow' || !off.has('subagent')))
  );
}

/** Preserve unrelated tools and ordering, including tools adopted from MCP after spawn. */
export function nextActiveToolNames(
  active: readonly string[],
  groups: ReadonlyMap<string, readonly string[]>,
  enabled: ReadonlySet<string>
): string[] {
  const off = new Set<string>();
  const on: string[] = [];
  for (const [id, names] of groups) {
    if (enabled.has(id)) on.push(...names);
    else for (const name of names) off.add(name);
  }
  const kept = active.filter((name) => !off.has(name));
  const present = new Set(kept);
  for (const name of on) {
    if (present.has(name)) continue;
    kept.push(name);
    present.add(name);
  }
  return kept;
}
