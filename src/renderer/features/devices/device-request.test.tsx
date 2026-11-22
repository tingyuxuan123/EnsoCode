// @vitest-environment happy-dom
import type { DeviceAccessEntry } from '@shared/device-agent';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DevicePermissions } from './device-permissions';
import { DeviceRequest } from './device-request';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

it('回答后两个入口都撤掉提示，过期快照不会复活卡片，会话授权仍可管理', async () => {
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
    allowedAccess: vi.fn(async () => []),
    onAccessChanged: vi.fn((cb: typeof push) => {
      if (push === undefined) push = cb;
      return off;
    }),
    answerAccess: vi.fn(
      async (_session: string, id: string, decision: 'always' | 'session' | 'deny') =>
        push({ ...entry, id, decision })
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
          <DevicePermissions sessionId="s" />
        </>
      )
    );
    expect(api.listAccess).toHaveBeenCalledTimes(1);
    await act(async () => push({ ...entry, sessionId: 'other' }));
    expect(div.querySelector('[data-device-access-surface]')).toBeNull();
    await act(async () => push(entry));
    expect(div.querySelectorAll('[data-device-access-surface]')).toHaveLength(2);
    await click('chat', 'session');
    await act(async () => initial.resolve([entry]));
    expect(div.querySelector('[data-device-access-surface]')).toBeNull();
    expect(div.textContent).not.toContain('Allowed for this conversation');
    const details = div.querySelector('details')!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event('toggle', { bubbles: true }));
    });
    const revoke = Array.from(details.querySelectorAll('button')).find(
      (button) => button.textContent === 'Revoke'
    );
    expect(revoke).toBeDefined();
    await act(async () => revoke!.click());
    expect(api.revokeAccess).toHaveBeenCalledWith('s', 'android:1');
    await act(async () => {
      details.open = false;
      details.dispatchEvent(new Event('toggle', { bubbles: true }));
    });
    const next = { ...entry, id: 'next' };
    await act(async () => push(next));
    await click('pane', 'always');
    expect(div.querySelector('[data-device-access-surface]')).toBeNull();
    expect(api.answerAccess.mock.calls).toEqual([
      ['s', 'ask', 'session'],
      ['s', 'next', 'always'],
    ]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
  expect(off).toHaveBeenCalledTimes(2);
});
