/** EnsoCode: fixed Main-owned script, no renderer materialization or node -e. */
import type { PluginContext } from '@vetta-org/plugin-sdk';
import { designEnginePath } from '../../../host/engine';
import { ownedDesignContextPath } from '../../../host/owned-context';

export async function ensureRunner(_ctx: PluginContext, _cwd: string): Promise<string> {
  throw new Error('Collabra owns the history runner; call runHistoryCommand instead');
}
export async function runHistoryCommand<T>(ctx: PluginContext, request: Record<string, unknown>): Promise<T> {
  const { dir, out: _out, from: _from, ...payload } = request;
  if (typeof dir !== 'string' || !dir) throw new Error('History command requires a design directory');
  const owned = await ownedDesignContextPath(ctx, dir);
  const target = owned ? { root: owned.root, designRel: owned.rel } : designEnginePath(dir);
  const response = await window.electronAPI.design.script({ script: 'history', ...target, payload });
  if (!response.ok) throw new Error(response.error);
  const result = response.result;
  if (result && typeof result === 'object' && 'ok' in result && result.ok === false) throw new Error('error' in result ? String(result.error) : 'History command failed');
  return result as T;
}
