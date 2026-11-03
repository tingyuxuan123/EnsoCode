import { beforeEach, expect, it, vi } from 'vitest';
import { mountDesignSnapshot, wrapDesignSnapshot } from './preview-snapshot';

const preview = vi.fn();
beforeEach(() => {
  preview.mockReset();
  vi.stubGlobal('window', { electronAPI: { design: { preview } } });
});
it('只使用Main独立origin URL且卸载关闭；不执行srcdoc或blob HTML', async () => {
  preview.mockResolvedValue({ ok: true, previewId: 'p', url: 'http://127.0.0.1:1234/secret' });
  const ready = vi.fn();
  const close = mountDesignSnapshot('<script>probe()</script>', ready);
  await vi.waitFor(() => expect(ready).toHaveBeenCalledWith('http://127.0.0.1:1234/secret'));
  close();
  close();
  await Promise.resolve();
  expect(preview).toHaveBeenCalledTimes(2);
  expect(preview).toHaveBeenLastCalledWith({ op: 'close', previewId: 'p' });
});
it('迟到open结果仍关闭，不复活已卸载快照', async () => {
  let finish: (value: unknown) => void = () => {};
  preview.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const ready = vi.fn();
  const close = mountDesignSnapshot('html', ready);
  await Promise.resolve();
  close();
  finish({ ok: true, previewId: 'late', url: 'http://127.0.0.1:1234/late' });
  await vi.waitFor(() => expect(preview).toHaveBeenCalledWith({ op: 'close', previewId: 'late' }));
  expect(ready).not.toHaveBeenCalled();
});
it('API不可用或拒绝则保持结构预览，不用srcdoc回退执行', async () => {
  preview.mockResolvedValue({ ok: false, error: 'unavailable' });
  const ready = vi.fn();
  mountDesignSnapshot('html', ready);
  await Promise.resolve();
  await Promise.resolve();
  expect(ready).not.toHaveBeenCalled();
});
it('wrapper隔离旧快照的MemoryRouter并仅中转精确parent/child来源', () => {
  const html = wrapDesignSnapshot('<script>"<&probe</script>');
  expect(html).toContain('sandbox="allow-scripts"');
  expect(html).not.toContain('allow-same-origin');
  expect(html).toContain('&lt;script>&quot;&lt;&amp;probe&lt;/script>');
  const parent = { postMessage: vi.fn() };
  const childWindow = { postMessage: vi.fn() };
  const child = { contentWindow: childWindow, addEventListener: vi.fn() };
  let receive: (event: { source: object; origin: string; data: unknown }) => void = () => {};
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  // Execute only our fixed wrapper bridge, never the supplied snapshot HTML.
  new Function('parent', 'document', 'addEventListener', script)(
    parent,
    { getElementById: () => child },
    (_name: string, cb: typeof receive) => {
      receive = cb;
    }
  );
  const show = { vetd: true, type: 'show-frame', id: 'second' };
  receive({ source: {}, origin: 'null', data: show });
  expect(childWindow.postMessage).not.toHaveBeenCalled();
  receive({ source: parent, origin: 'file://', data: show });
  expect(childWindow.postMessage).toHaveBeenCalledWith(show, '*');
  childWindow.postMessage.mockClear();
  receive({ source: {}, origin: 'null', data: { vetd: true, type: 'ready' } });
  expect(childWindow.postMessage).not.toHaveBeenCalled();
  receive({ source: childWindow, origin: 'null', data: { vetd: true, type: 'ready' } });
  expect(childWindow.postMessage).toHaveBeenCalledWith(show, '*');
  expect(parent.postMessage).toHaveBeenCalledWith({ vetd: true, type: 'ready' }, '*');
});
