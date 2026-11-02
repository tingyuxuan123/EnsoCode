import { afterEach, expect, it, vi } from 'vitest';
import { materializeEngineForTest } from '../src/engine/engine-manager';
afterEach(() => vi.unstubAllGlobals());
it('does not send engine templates or arbitrary command payloads from renderer', async () => {
  const engine = vi.fn(async (_request: unknown) => ({ ok: true, engineRoot: '/data/design/engine', engineVersion: '1', npm: null }));
  vi.stubGlobal('electronAPI', { design: { engine } });
  await materializeEngineForTest({} as never, '/ignored', '/work/a.vetd');
  expect(engine.mock.calls).toEqual([[{ op: 'diagnostics' }]]);
});
