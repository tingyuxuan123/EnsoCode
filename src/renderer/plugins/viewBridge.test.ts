import { expect, it, vi } from 'vitest';
import { createViewBridge, decodeUtf8Base64, validViewInit } from './viewBridge';

it('forwards only valid MessagePort requests and returns errors', async () => {
  const call = vi.fn(async () => 'ok');
  const handle = createViewBridge(call);
  expect(await handle({ id: 1, method: 'list', args: {} })).toEqual({
    id: 1,
    ok: true,
    value: 'ok',
  });
  for (const bad of [
    null,
    {},
    { id: {}, method: 'list' },
    { id: 1, method: 'x'.repeat(129) },
    { id: 1, method: '' },
  ])
    expect(await handle(bad)).toBeNull();
  expect(call).toHaveBeenCalledTimes(1);
  expect(
    await createViewBridge(async () => {
      throw new Error('boom');
    })({ id: 2, method: 'x' })
  ).toEqual({ id: 2, ok: false, error: 'boom' });
  expect(decodeUtf8Base64(btoa(String.fromCharCode(...new TextEncoder().encode('你好'))))).toBe(
    '你好'
  );
});
it('rejects strangers, missing ports and mismatched initialization nonces', () => {
  const parent = {};
  const data = { type: 'enso-view-init', nonce: 'secret', html: '<p>hi</p>' };
  expect(validViewInit({ source: parent, data, ports: [{}] }, parent, 'secret')).toBe(true);
  for (const event of [
    { source: {}, data, ports: [{}] },
    { source: parent, data, ports: [] },
    { source: parent, data: { ...data, nonce: 'wrong' }, ports: [{}] },
  ])
    expect(validViewInit(event, parent, 'secret')).toBe(false);
});
it('侧栏以父 frame 收到消息时的激活为准，忽略 iframe 自报手势', async () => {
  const call = vi.fn(async () => null);
  let active = false;
  const handle = createViewBridge(call, () => active);
  await handle({ id: 1, method: 'draft', gesture: true });
  expect(call).toHaveBeenLastCalledWith('draft', null, false);
  active = true;
  await handle({ id: 2, method: 'draft' });
  expect(call).toHaveBeenLastCalledWith('draft', null, true);
});
