// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageQueue } from './MessageQueue';

const { pending, actions } = vi.hoisted(() => ({
  pending: new Set<string>(),
  actions: {
    updateQueuedMessage: vi.fn(),
    withdrawMessage: vi.fn(),
    sendQueuedNow: vi.fn(),
    interruptAndSendQueued: vi.fn(),
    removeQueuedMessage: vi.fn(),
  },
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/deviceAccess', () => ({
  usePendingDeviceAccess: (id: string) => pending.has(id),
  hasPendingDeviceAccess: (id: string) => pending.has(id),
}));
vi.mock('@/stores/sessions', () => ({ useSessionsStore: { getState: () => actions } }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  pending.clear();
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function show(id: string) {
  // Same queue id in both sessions, even though the messages are independent.
  act(() => root.render(<MessageQueue conversationId={id} queued={[{ id: 'q', text: id }]} />));
}
function button(title: string) {
  const element = host.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  if (!element) throw new Error(`Missing ${title}`);
  return element;
}
function input() {
  const element = host.querySelector('input');
  if (!element) throw new Error('Missing edit input');
  return element;
}
function type(value: string) {
  const element = input();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function key(key: string) {
  act(() => {
    input().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
  });
}

const guarded = ['Edit', 'Withdraw message', 'Send now', 'Interrupt and send now'];
describe('device access gates only its own queue', () => {
  it('rechecks edit, withdraw and both manual sends before the pending render', () => {
    show('a');
    pending.add('a');
    for (const title of guarded) act(() => button(title).click());
    expect(host.querySelector('input')).toBeNull();
    expect(actions.withdrawMessage).not.toHaveBeenCalled();
    expect(actions.sendQueuedNow).not.toHaveBeenCalled();
    expect(actions.interruptAndSendQueued).not.toHaveBeenCalled();
    show('a');
    for (const title of guarded) expect(button(title).disabled).toBe(true);
    act(() => button('Remove').click());
    expect(actions.removeQueuedMessage).toHaveBeenCalledWith('a', 'q');

    show('b');
    for (const title of guarded) expect(button(title).disabled).toBe(false);
    for (const title of guarded.slice(1)) act(() => button(title).click());
    expect(actions.withdrawMessage).toHaveBeenCalledWith('b', { kind: 'queue', id: 'q' });
    expect(actions.sendQueuedNow).toHaveBeenCalledWith('b', 'q');
    expect(actions.interruptAndSendQueued).toHaveBeenCalledWith('b', 'q');
  });

  it('drops an obsolete draft if its queued message is removed', () => {
    show('removed');
    act(() => button('Edit').click());
    type('discard when removed');
    act(() => root.render(<MessageQueue conversationId="removed" queued={[]} />));
    show('removed');
    expect(host.querySelector('input')).toBeNull();
    expect(actions.updateQueuedMessage).not.toHaveBeenCalled();
  });

  it('freezes in-flight edits without losing or transferring a session draft', () => {
    show('first');
    act(() => button('Edit').click());
    type('unsaved first');
    pending.add('first'); // Handlers still belong to the enabled render.
    type('late change');
    key('Enter');
    key('Escape');
    act(() => button('Save').click());
    expect(actions.updateQueuedMessage).not.toHaveBeenCalled();
    show('first');
    expect(input().disabled).toBe(true);
    expect(input().value).toBe('unsaved first');
    expect(button('Save').disabled).toBe(true);

    act(() => root.render(null));
    show('second');
    expect(host.querySelector('input')).toBeNull();
    act(() => button('Edit').click());
    type('second draft');
    show('first');
    pending.delete('first');
    show('first');
    expect(input().value).toBe('unsaved first');
    key('Enter');
    expect(actions.updateQueuedMessage).toHaveBeenCalledWith('first', 'q', 'unsaved first');
    show('second');
    expect(input().value).toBe('second draft');
    key('Escape');
    expect(host.querySelector('input')).toBeNull();
    expect(actions.updateQueuedMessage).toHaveBeenCalledTimes(1);
  });
});
