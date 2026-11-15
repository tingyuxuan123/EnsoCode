/** @vitest-environment happy-dom */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionDrawer } from './SessionDrawer';
import { usePhoneBack } from './usePhoneBack';

vi.mock('./FileDownloads', () => ({ FileDownloads: () => null }));
vi.mock('./usePhoneBack', () => ({ usePhoneBack: vi.fn() }));
const noop = () => {};
const props: Parameters<typeof SessionDrawer>[0] = {
  open: true,
  projects: [{ id: 'p', name: 'Project', path: '/fixture' }],
  catalog: [
    {
      id: 's',
      title: 'Wait for me',
      projectName: 'Project',
      projectId: 'p',
      status: 'idle',
      pendingAskCount: 1,
    },
  ],
  activeId: 's',
  canCreate: true,
  devices: [
    {
      pairId: 'd',
      label: 'Desktop',
      deviceName: 'Phone',
      token: 'fixture',
      contentKey: 'fixture',
      relayUrl: 'https://relay.example',
      pairedAt: 1,
    },
  ],
  activeDevicePairId: 'd',
  connected: true,
  connectionLabel: '已连接',
  pushEnabled: true,
  pushBusy: false,
  pushError: null,
  pushAvailability: 'ok',
  pushConfigReady: true,
  onClose: noop,
  onSelect: noop,
  onNewConversation: noop,
  onTogglePush: noop,
  onSwitchDevice: noop,
  onAddDevice: noop,
  onRenameDevice: noop,
  onUnpairDevice: noop,
};
beforeEach(() => {
  vi.mocked(usePhoneBack).mockClear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('__COMMIT__', 'test');
});
afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('keeps device controls off the list and opens them in their own screen', async () => {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const togglePush = vi.fn();
  await act(async () =>
    root.render(
      createElement(SessionDrawer, { ...props, deviceReadOnly: true, onTogglePush: togglePush })
    )
  );
  expect(host.textContent).toContain('1 个等你');
  expect(host.textContent).not.toContain('推送通知');
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="设备与通知"]')?.click()
  );
  expect(host.textContent).toContain('推送通知');
  expect(host.textContent).toContain('只能查看');
  await act(async () => host.querySelector<HTMLElement>('[data-slot="switch"]')?.click());
  expect(togglePush).toHaveBeenCalledWith(false, expect.anything());
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="返回会话列表"]')?.click()
  );
  expect(host.textContent).not.toContain('推送通知');
  await act(async () => root.unmount());
});

it('can still open and fold a project, and disables hidden list interactions', async () => {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const select = vi.fn();
  await act(async () => root.render(createElement(SessionDrawer, { ...props, onSelect: select })));
  const row = [...host.querySelectorAll('button')].find(
    (button) => button.textContent?.includes('Wait for me') && !button.hasAttribute('aria-label')
  );
  await act(async () => row?.click());
  expect(select).toHaveBeenCalledExactlyOnceWith('s');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.click());
  expect(host.textContent).not.toContain('Wait for me');
  await act(async () => root.render(createElement(SessionDrawer, { ...props, open: false })));
  expect(host.querySelector('aside')?.hasAttribute('inert')).toBe(true);
  await act(async () => root.unmount());
});

it('has a visible in-app return action on mobile, but does not close a pinned sidebar', async () => {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const close = vi.fn();
  await act(async () => root.render(createElement(SessionDrawer, { ...props, onClose: close })));
  const back = host.querySelector<HTMLButtonElement>('[aria-label="返回会话"]');
  expect(back).not.toBeNull();
  await act(async () => back?.click());
  expect(close).toHaveBeenCalledOnce();
  await act(async () =>
    root.render(createElement(SessionDrawer, { ...props, docked: true, onClose: close }))
  );
  expect(host.querySelector('[aria-label="返回会话"]')).toBeNull();
  await act(async () => root.unmount());
});

it('does not turn a Back-opened root list into a chat/list Back loop', async () => {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  await act(async () =>
    root.render(createElement(SessionDrawer, { ...props, backToConversation: false }))
  );
  expect(usePhoneBack).toHaveBeenCalledWith(false, props.onClose, 10);
  // The visible arrow can still explicitly reopen the conversation.
  expect(host.querySelector('[aria-label="返回会话"]')).not.toBeNull();
  await act(async () => root.unmount());
});
