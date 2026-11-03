import { IS_MAC } from '@/lib/keybindings';
import type { PluginShortcutScopeContribution } from '../vetta/sdk/shortcuts';

/** Caller must own focus. Host bindings and native text editing always win. */
export function dispatchDesignShortcut(
  event: KeyboardEvent,
  scopes: readonly PluginShortcutScopeContribution[],
  editable: boolean,
  reserved: readonly string[]
): boolean {
  if (event.defaultPrevented || event.isComposing || editable) return false;
  const key = [
    (IS_MAC ? event.metaKey : event.ctrlKey) && 'mod',
    IS_MAC && event.ctrlKey && 'ctrl',
    event.altKey && 'alt',
    event.shiftKey && 'shift',
    event.key.toLowerCase(),
  ]
    .filter(Boolean)
    .join('+');
  if (reserved.includes(key)) return false;
  for (const scope of [...scopes].reverse()) {
    if (scope.enabled && !scope.enabled()) continue;
    const bindings = typeof scope.bindings === 'function' ? scope.bindings() : scope.bindings;
    const binding = bindings.find((item) => item.key === key && item.when !== 'editable');
    if (!binding) continue;
    if (binding.preventDefault !== false) event.preventDefault();
    if (binding.stopPropagation !== false) event.stopPropagation();
    binding.run(event);
    return true;
  }
  return false;
}
