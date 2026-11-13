import type { PluginCommandRef } from './commands';
export const pluginKeybindingAction = (pluginId: string, commandId: string) =>
  `plugin:${pluginId}:${commandId}`;
export interface PluginKeybindingRow {
  action: string;
  command: PluginCommandRef;
  binding: string;
  custom: boolean;
  conflict?: string;
}
/** Builtins always win; explicit empty overrides disable plugin defaults. */
export function resolvePluginKeybindings(
  commands: readonly PluginCommandRef[],
  overrides: Record<string, string>,
  builtin: Record<string, string>
): { rows: PluginKeybindingRow[]; byBinding: Map<string, PluginCommandRef> } {
  const taken = new Map<string, string>();
  for (const [action, binding] of Object.entries(builtin)) if (binding) taken.set(binding, action);
  const byBinding = new Map<string, PluginCommandRef>();
  const rows = commands.map((command) => {
    const action = pluginKeybindingAction(command.pluginId, command.id);
    const custom = overrides[action] !== undefined;
    const binding = custom ? overrides[action] : (command.key ?? '');
    const conflict = binding ? taken.get(binding) : undefined;
    if (binding && !conflict) {
      taken.set(binding, action);
      byBinding.set(binding, command);
    }
    return { action, command, binding, custom, ...(conflict ? { conflict } : {}) };
  });
  return { rows, byBinding };
}
