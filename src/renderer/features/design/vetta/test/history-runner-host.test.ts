import { afterEach, expect, it, vi } from 'vitest';
import type { PluginContext } from '@vetta-org/plugin-sdk';
import { designPaths } from '../../host/paths';
import { runHistoryCommand, ensureRunner } from '../src/history/runner-host';

afterEach(() => vi.unstubAllGlobals());
it('uses a fixed script with identifiers and strips absolute dir/out/from', async () => {
  designPaths.remember({ ref: { kind: 'session', sessionId: 'host-test' }, path: '/work' });
  const script = vi.fn(async () => ({ ok: true, result: { ok: true, size: 12 } }));
  vi.stubGlobal('electronAPI', { design: { script } });
  expect(await runHistoryCommand({} as PluginContext, { cmd: 'pack', dir: '/work/a.vetd', out: '/tmp/evil', from: '/tmp/evil' })).toEqual({ ok: true, size: 12 });
  expect(script.mock.calls[0]).toEqual([{ script: 'history', root: { kind: 'session', sessionId: 'host-test' }, designRel: 'a.vetd', payload: { cmd: 'pack' } }]);
});
it('rejects unknown roots and does not send an IPC', async () => {
  const script = vi.fn(); vi.stubGlobal('electronAPI', { design: { script } });
  await expect(runHistoryCommand({} as PluginContext, { cmd: 'log', dir: '/unknown/a.vetd' })).rejects.toThrow();
  expect(script).not.toHaveBeenCalled();
});
it('does not allow renderer-owned runner materialization', async () => {
  await expect(ensureRunner({} as PluginContext, '/work')).rejects.toThrow('小满 owns');
});
