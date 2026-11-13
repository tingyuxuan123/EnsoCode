import { expect, it, vi } from 'vitest';
import { handleSessionRequest, type SessionBridgeDeps } from './sessionBridge';

function setup() {
  const deps: SessionBridgeDeps = {
    conversation: (id) => (id === 'origin' || id === 'other' ? { projectId: 'project' } : null),
    focus: vi.fn(),
    focusSubagent: vi.fn(() => false),
    openChildRun: vi.fn(() => false),
    create: vi.fn(async () => 'created'),
    prefill: vi.fn(),
    ensure: vi.fn(async () => null),
    openPluginView: vi.fn(() => false),
  };
  return deps;
}
it('never guesses child identity from a delimited session string', async () => {
  const deps = setup();
  const result = await handleSessionRequest(
    { sessionId: 'origin', op: 'focusSession', payload: { sessionId: 'origin::guessed' } },
    deps
  );
  expect(result.ok).toBe(false);
  expect(deps.focusSubagent).not.toHaveBeenCalled();
  expect(deps.focus).not.toHaveBeenCalled();
});
it('creates in the origin project with the requested preset and prefills without sending', async () => {
  const deps = setup();
  expect(
    await handleSessionRequest(
      {
        sessionId: 'origin',
        op: 'createSession',
        payload: { presetId: 'local.test/preset', text: 'Draft' },
      },
      deps
    )
  ).toEqual({ ok: true, value: { sessionId: 'created' } });
  expect(deps.create).toHaveBeenCalledWith('project', 'local.test/preset');
  expect(deps.prefill).toHaveBeenCalledWith('created', 'Draft');
});
it('rejects missing origin sessions and unregistered plugin views', async () => {
  const deps = setup();
  expect(
    (
      await handleSessionRequest(
        { sessionId: 'missing', op: 'focusSession', payload: { sessionId: 'other' } },
        deps
      )
    ).ok
  ).toBe(false);
  expect(
    (
      await handleSessionRequest(
        {
          sessionId: 'origin',
          op: 'openPluginView',
          payload: { pluginId: 'local.test', viewId: 'panel', title: 'Panel' },
        },
        deps
      )
    ).ok
  ).toBe(false);
});
