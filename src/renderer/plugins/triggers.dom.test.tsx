import { parseHTML } from 'linkedom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setPluginTriggers, usePluginTriggerCandidates } from './triggers';

let root: Root;
let container: HTMLElement;
const call = vi.fn();
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal(
    'window',
    Object.assign(dom.window, { electronAPI: { extensionPlugins: { call } } })
  );
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = dom.document.getElementById('root')!;
  root = createRoot(container);
  vi.useFakeTimers();
  call.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  setPluginTriggers([]);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function Probe({ query }: { query: string }) {
  const items = usePluginTriggerCandidates(query, 's1');
  return createElement('span', null, items.map((item) => item.item.label).join(','));
}
it('debounces queries and discards stale and disabled-plugin results', async () => {
  let old!: (result: object) => void;
  call
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          old = resolve;
        })
    )
    .mockResolvedValue({ ok: true, value: [{ id: 'new', label: 'new' }] });
  setPluginTriggers([{ pluginId: 'a.b', name: 'demo' }]);
  await act(async () => root.render(createElement(Probe, { query: 'old' })));
  await act(async () => vi.advanceTimersByTime(119));
  expect(call).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1));
  expect(call).toHaveBeenCalledTimes(1);
  await act(async () => root.render(createElement(Probe, { query: 'new' })));
  await act(async () => {
    old({ ok: true, value: [{ id: 'old', label: 'stale' }] });
  });
  expect(container.textContent).toBe('');
  await act(async () => vi.advanceTimersByTime(120));
  expect(container.textContent).toBe('new');
  await act(async () => setPluginTriggers([]));
  expect(container.textContent).toBe('');
});
