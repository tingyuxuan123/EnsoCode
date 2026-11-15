/** @vitest-environment happy-dom */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { usePhoneBack } from './usePhoneBack';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('an explicit close schedules browser microtasks without borrowing their receiver', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const schedule = globalThis.queueMicrotask.bind(globalThis);
  vi.stubGlobal('queueMicrotask', function (this: unknown, callback: VoidFunction) {
    if (this !== undefined && this !== globalThis && this !== window)
      throw new TypeError('Illegal invocation');
    schedule(callback);
  });
  vi.spyOn(window.history, 'back').mockImplementation(() => {
    window.history.replaceState(null, '');
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  });
  const host = document.body.appendChild(document.createElement('div'));
  const errors = vi.fn();
  const close = vi.fn();
  function Probe({ open }: { open: boolean }) {
    usePhoneBack(open, close, 10);
    return createElement('p', {}, open ? 'list' : 'chat');
  }
  const root = createRoot(host, { onUncaughtError: errors });
  await act(async () => root.render(createElement(Probe, { open: true })));
  await act(async () => root.render(createElement(Probe, { open: false })));
  expect(errors).not.toHaveBeenCalled();
  expect(host.textContent).toBe('chat');
  expect(close).not.toHaveBeenCalled();
  expect(window.history.back).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
});
