import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SnapshotFrame } from '../src/preview/PreviewCanvas';

it('外层iframe只加载Main URL且不允许same-origin，opaque ready只能由精确子window触发重发', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const loaded = vi.fn();
  const target = { postMessage: vi.fn() };
  try {
    await act(async () => root.render(<SnapshotFrame url="http://127.0.0.1:1234/token" frameId="second" onLoaded={loaded} />));
    const frame = container.querySelector('iframe')!;
    Object.defineProperty(frame, 'contentWindow', { value: target, configurable: true });
    expect(frame.getAttribute('src')).toBe('http://127.0.0.1:1234/token');
    expect(frame.hasAttribute('srcdoc')).toBe(false);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    const send = (source: object, origin = 'null') => window.dispatchEvent(new MessageEvent('message', { source: source as Window, origin, data: { vetd: true, type: 'ready' } }));
    send({}); send(target, 'http://127.0.0.1:1234');
    expect(target.postMessage).not.toHaveBeenCalled();
    send(target);
    expect(target.postMessage).toHaveBeenCalledWith({ vetd: true, type: 'show-frame', id: 'second' }, '*');
    frame.dispatchEvent(new Event('load'));
    expect(loaded).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});
