// @vitest-environment happy-dom
import type { DeviceAccessEntry } from '@shared/device-agent';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DeviceRequest } from './device-request';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

it('shares one request across both surfaces, even when a stale initial read finishes after the answer', async () => {
  const entry: DeviceAccessEntry = {
    kind: 'device_access',
    id: 'ask',
    sessionId: 's',
    deviceId: 'android:1',
    deviceName: 'emulator',
    expiresAt: Date.now() + 120_000,
    decision: null,
  };
  let push!: (entry: DeviceAccessEntry) => void;
  const initial = Promise.withResolvers<DeviceAccessEntry[]>();
  const off = vi.fn();
  const api = {
    listAccess: vi.fn(() => initial.promise),
    onAccessChanged: vi.fn((cb: typeof push) => {
      push = cb;
      return off;
    }),
    answerAccess: vi.fn(
      async (_session: string, _id: string, decision: 'always' | 'session' | 'deny') =>
        push({ ...entry, decision })
    ),
    revokeAccess: vi.fn(async () => push({ ...entry, decision: 'session', revoked: true })),
  };
  vi.stubGlobal('electronAPI', { devices: api });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const div = document.createElement('div');
  const root = createRoot(div);
  const click = async (surface: string, decision: string) => {
    const btn = div.querySelector<HTMLButtonElement>(
      `[data-device-access-surface="${surface}"] [data-device-decision="${decision}"]`
    );
    expect(btn).not.toBeNull();
    await act(async () => btn!.click());
  };
  try {
    await act(async () =>
      root.render(
        <>
          <DeviceRequest surface="chat" sessionId="s" />
          <DeviceRequest sessionId="s" />
        </>
      )
    );
    expect(api.listAccess).toHaveBeenCalledTimes(1);
    await act(async () => push({ ...entry, sessionId: 'other' }));
    expect(div.children).toHaveLength(0);
    await act(async () => push(entry));
    await click('chat', 'session');
    await act(async () => initial.resolve([entry]));
    expect(div.querySelectorAll('[data-device-decision="revoke"]')).toHaveLength(2);
    await click('pane', 'revoke');
    expect(div.querySelectorAll('[data-device-decision]')).toHaveLength(0);
    expect(api.revokeAccess).toHaveBeenCalledWith('s', 'android:1');
    const next = { ...entry, id: 'next' };
    await act(async () => push(next));
    await click('pane', 'always');
    expect(api.answerAccess.mock.calls).toEqual([
      ['s', 'ask', 'session'],
      ['s', 'next', 'always'],
    ]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
  expect(off).toHaveBeenCalledTimes(1);
});
