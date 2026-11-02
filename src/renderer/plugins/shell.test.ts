import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { DOMParser, parseHTML } from 'linkedom';
import { expect, it, vi } from 'vitest';

it('the actual opaque iframe shell accepts only the parent nonce and a single port', () => {
  const html = readFileSync(new URL('../public/plugin-view.html', import.meta.url), 'utf8');
  const code = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  expect(code).toBeTruthy();
  const dom = parseHTML('<html><head></head><body></body></html>');
  const listeners = new Map<string, (event: object) => void>();
  const parent = {};
  const window = {
    parent,
    addEventListener: (name: string, listener: (event: object) => void) =>
      listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  runInNewContext(code!, {
    window,
    document: dom.document,
    location: { hash: '#nonce' },
    DOMParser,
    Node: dom.window.Node,
    Map,
    Object,
    Promise,
    Error,
    String,
  });
  const init = listeners.get('message')!;
  const data = {
    type: 'enso-view-init',
    nonce: 'nonce',
    html: '<html><head></head><body><main>safe note</main></body></html>',
    theme: 'dark',
  };
  const port = { onmessage: null, postMessage: vi.fn() };
  for (const event of [
    { source: {}, data, ports: [port] },
    { source: parent, data: { ...data, nonce: 'foreign' }, ports: [port] },
    { source: parent, data, ports: [] },
  ])
    init(event);
  expect(dom.document.body.textContent).toBe('');
  expect(port.onmessage).toBeNull();
  init({ source: parent, data, ports: [port] });
  expect(dom.document.body.textContent).toContain('safe note');
  expect(dom.document.documentElement.dataset.theme).toBe('dark');
  expect(listeners.has('message')).toBe(false);
  expect(port.onmessage).toBeTypeOf('function');
  expect(html).toContain("connect-src 'none'");
  expect(html).toContain("form-action 'none'");
  expect(html).not.toContain('document.write');
});
