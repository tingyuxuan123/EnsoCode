import type { BrowserRecordsQuery, BrowserResult } from '@shared/types/browser';
import { parseHTML } from 'linkedom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBrowserRecords } from './BrowserRecords';

const t = (key: string) => key;
vi.mock('@/i18n', () => ({ useI18n: () => ({ t }) }));
vi.mock('@/components/ui/button', () => ({ Button: () => null }));

type Page = BrowserResult<{ items: string[]; total: number }>;
let root: Root;
let records: ReturnType<typeof useBrowserRecords<string>>;
const load = vi.fn<(request: BrowserRecordsQuery) => Promise<Page>>();
function Harness({ open = true }: { open?: boolean }) {
  records = useBrowserRecords(open, 'conversation', load);
  return (
    <div>
      {records.items.join(',')}
      {records.error}
    </div>
  );
}
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(dom.document.getElementById('root') as unknown as HTMLElement);
  load.mockReset().mockResolvedValue({ ok: true, result: { items: [], total: 60 } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('browser record lists', () => {
  it('loads bounded pages and resets pagination when a search changes', async () => {
    await act(async () => root.render(<Harness />));
    expect(load).toHaveBeenLastCalledWith({ query: '', offset: 0, limit: 30 });
    await act(async () => records.setOffset(30));
    expect(load).toHaveBeenLastCalledWith({ query: '', offset: 30, limit: 30 });
    vi.useFakeTimers();
    await act(async () => records.setQuery('example'));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(load).toHaveBeenLastCalledWith({ query: 'example', offset: 0, limit: 30 });
  });

  it('does not let an earlier page response replace the current page', async () => {
    const earlier = deferred<Page>();
    load
      .mockReturnValueOnce(earlier.promise)
      .mockResolvedValue({ ok: true, result: { items: ['current'], total: 60 } });
    await act(async () => root.render(<Harness />));
    await act(async () => records.setOffset(30));
    await act(async () => earlier.resolve({ ok: true, result: { items: ['stale'], total: 60 } }));
    expect(records.items).toEqual(['current']);
  });

  it('keeps a successful action valid when a download refresh arrives in flight', async () => {
    await act(async () => root.render(<Harness />));
    const action = deferred<BrowserResult<unknown>>();
    let result!: Promise<boolean>;
    await act(async () => {
      result = records.run(() => action.promise);
    });
    await act(async () => records.refresh());
    await act(async () => action.resolve({ ok: true, result: {} }));
    expect(await result).toBe(true);
    expect(records.busy).toBe(false);
  });

  it('preserves action errors when background progress refreshes', async () => {
    await act(async () => root.render(<Harness />));
    await act(async () =>
      records.run(async () => ({ ok: false, error: 'Cannot pause this download' }))
    );
    await act(async () => records.refresh());
    expect(records.error).toBe('Cannot pause this download');
  });
});
