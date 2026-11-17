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
    closePluginView: vi.fn(),
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
it('closes only the requested plugin view, and validates the identifiers', async () => {
  const deps = setup();
  await expect(
    handleSessionRequest(
      {
        sessionId: 'origin',
        op: 'closePluginView',
        payload: { pluginId: 'local.test', viewId: 'panel' },
      },
      deps
    )
  ).resolves.toEqual({ ok: true, value: null });
  expect(deps.closePluginView).toHaveBeenCalledWith('origin', {
    pluginId: 'local.test',
    viewId: 'panel',
  });

  // 发起会话不在本窗口：不能替别的窗口关页面
  await expect(
    handleSessionRequest(
      { sessionId: 'missing', op: 'closePluginView', payload: { pluginId: 'p', viewId: 'v' } },
      deps
    )
  ).resolves.toMatchObject({ ok: false, code: 'NO_SESSION' });
  // 缺视图标识只报错，不乱关当前页
  await expect(
    handleSessionRequest(
      { sessionId: 'origin', op: 'closePluginView', payload: { pluginId: 'p' } },
      deps
    )
  ).resolves.toMatchObject({ ok: false, code: 'BAD_REQUEST' });
  expect(deps.closePluginView).toHaveBeenCalledTimes(1);
});
