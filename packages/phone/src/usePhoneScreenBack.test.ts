/** @vitest-environment happy-dom */
import { act, createElement, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function fixture(
  options: { initialListOpen?: boolean; docked?: boolean; enabled?: boolean } = {}
) {
  vi.resetModules();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const { usePhoneBack } = await import('./usePhoneBack');
  const { usePhoneScreenBack } = await import('./usePhoneScreenBack');
  const entries: unknown[] = [{ outside: true }, { launch: 'preserved' }];
  const registration = vi.spyOn(window, 'addEventListener');
  let index = 1;
  let exits = 0;
  vi.spyOn(window.history, 'state', 'get').mockImplementation(() => entries[index]);
  vi.spyOn(window.history, 'pushState').mockImplementation((state) => {
    entries.splice(index + 1);
    entries.push(state);
    index++;
  });
  const back = () => {
    index--;
    if (index === 0) exits++;
    window.dispatchEvent(new PopStateEvent('popstate', { state: entries[index] }));
  };
  vi.spyOn(window.history, 'back').mockImplementation(() => queueMicrotask(back));
  function Probe() {
    const navigation = usePhoneScreenBack({
      initialListOpen: options.initialListOpen ?? false,
      docked: options.docked ?? false,
      enabled: options.enabled ?? true,
    });
    const [sheet, setSheet] = useState(false);
    usePhoneBack(
      navigation.drawerOpen && navigation.backToConversation && !options.docked,
      navigation.closeDrawer,
      10
    );
    usePhoneBack(sheet, () => setSheet(false), 50);
    return createElement(
      'div',
      {},
      createElement('p', { 'data-screen': true }, navigation.drawerOpen ? 'list' : 'conversation'),
      createElement('p', { 'data-sheet': true }, sheet ? 'open' : 'closed'),
      createElement('button', { type: 'button', onClick: navigation.openDrawer }, 'list'),
      createElement('button', { type: 'button', onClick: navigation.closeDrawer }, 'conversation'),
      createElement('button', { type: 'button', onClick: () => setSheet(true) }, 'sheet')
    );
  }
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  await act(async () => root.render(createElement(StrictMode, {}, createElement(Probe))));
  return {
    entries,
    index: () => index,
    exits: () => exits,
    screen: () => host.querySelector('[data-screen]')?.textContent,
    sheet: () => host.querySelector('[data-sheet]')?.textContent,
    back: async () => act(async () => back()),
    forward: async () =>
      act(async () => {
        index++;
        window.dispatchEvent(new PopStateEvent('popstate', { state: entries[index] }));
      }),
    click: async (name: string) =>
      act(async () => {
        [...host.querySelectorAll('button')].find((button) => button.textContent === name)?.click();
      }),
    close: async () => {
      await act(async () => root.unmount());
      for (const [type, listener] of registration.mock.calls) {
        if (type === 'popstate') window.removeEventListener(type, listener);
      }
    },
  };
}

it('Back from a restored conversation opens the root list before a second Back can exit', async () => {
  const f = await fixture();
  expect(f.screen()).toBe('conversation');
  await f.back();
  expect(f.screen()).toBe('list');
  expect(f.exits()).toBe(0);
  expect(f.index()).toBe(1);
  await f.back();
  expect(f.exits()).toBe(1);
  await f.close();
});

it('selecting a conversation from the initial list also protects its Back', async () => {
  const f = await fixture({ initialListOpen: true });
  expect(f.index()).toBe(1);
  await f.click('conversation');
  expect(f.index()).toBe(2);
  await f.back();
  expect(f.screen()).toBe('list');
  expect(f.exits()).toBe(0);
  await f.close();
});

it('a toolbar-opened list returns to chat, then chat Back returns to the root list', async () => {
  const f = await fixture();
  await f.click('list');
  await f.back();
  expect(f.screen()).toBe('conversation');
  expect(f.exits()).toBe(0);
  await f.back();
  expect(f.screen()).toBe('list');
  expect(f.index()).toBe(1);
  await f.close();
});

it('a sheet closes before the conversation returns to its root list', async () => {
  const f = await fixture();
  await f.click('sheet');
  await f.back();
  expect(f.sheet()).toBe('closed');
  expect(f.screen()).toBe('conversation');
  await f.back();
  expect(f.screen()).toBe('list');
  expect(f.exits()).toBe(0);
  await f.close();
});

it('visible list/return controls do not consume the conversation guard or grow history', async () => {
  const f = await fixture();
  for (let i = 0; i < 5; i++) {
    await f.click('list');
    await f.click('conversation');
    expect(f.screen()).toBe('conversation');
    expect(f.index()).toBe(2);
    expect(f.entries).toHaveLength(3);
  }
  await f.back();
  expect(f.screen()).toBe('list');
  expect(f.exits()).toBe(0);
  await f.close();
});

it('Back from root-list settings stays on the list, not the previous conversation', async () => {
  const f = await fixture();
  await f.back();
  await f.click('sheet');
  await f.back();
  expect(f.sheet()).toBe('closed');
  expect(f.screen()).toBe('list');
  expect(f.exits()).toBe(0);
  await f.back();
  expect(f.exits()).toBe(1);
  await f.close();
});

it('Forward does not reopen the chat or add another Back step to the root list', async () => {
  const f = await fixture();
  await f.back();
  await f.forward();
  expect(f.screen()).toBe('list');
  expect(f.index()).toBe(1);
  expect(f.exits()).toBe(0);
  await f.back();
  expect(f.exits()).toBe(1);
  await f.close();
});

it.each([{ docked: true }, { enabled: false }])(
  'does not intercept pinned desktop or unpaired screens: %j',
  async (options) => {
    const f = await fixture(options);
    expect(f.index()).toBe(1);
    expect(window.history.pushState).not.toHaveBeenCalled();
    await f.close();
  }
);
