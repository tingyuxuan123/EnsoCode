import { expect, it } from 'vitest';
import {
  allowedNetworkUrl,
  networkRequestTier,
  publicNetworkAddress,
  requestNetwork,
} from './network';

const publicDns = async () => ['8.8.8.8'];

it('固定主机、https、默认端口且无凭证，拒绝相似域名', () => {
  for (const url of [
    'https://api.openverse.org/v1/images/',
    'https://raw.githubusercontent.com/openvetta/a',
    'https://upload.wikimedia.org/a',
    'https://fastly.picsum.photos/a',
  ])
    expect(allowedNetworkUrl(url)).toBe(true);
  for (const url of [
    'http://api.openverse.org/',
    'https://user:pass@api.openverse.org/',
    'https://api.openverse.org.evil.test/',
    'https://127.0.0.1/',
    'https://api.openverse.org:8443/',
    'file:///etc/passwd',
  ])
    expect(allowedNetworkUrl(url)).toBe(false);
});
it('每一跳重定向也要过白名单，不能绕过主机检查', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } });
  };
  await expect(
    requestNetwork({ url: 'https://picsum.photos/id/1/200/200' }, fetcher, publicDns)
  ).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
  expect(calls).toBe(1);
});
it('流式响应超限及时拒绝', async () => {
  const fetcher: typeof fetch = async () => new Response(new Uint8Array(10 * 1024 * 1024 + 1));
  await expect(
    requestNetwork({ url: 'https://picsum.photos/' }, fetcher, publicDns)
  ).rejects.toMatchObject({ code: 'TOO_LARGE' });
});
it('任意外域只开放 GET base64 图片档，JSON 与 POST 不开放', () => {
  expect(
    networkRequestTier({ url: 'https://photos.example/image.jpg', responseType: 'base64' })
  ).toBe('image');
  expect(networkRequestTier({ url: 'https://photos.example/image.jpg' })).toBeNull();
  expect(
    networkRequestTier({
      url: 'https://photos.example/image.jpg',
      method: 'POST',
      responseType: 'base64',
    })
  ).toBeNull();
  expect(
    networkRequestTier({ url: 'https://user@photos.example/image.jpg', responseType: 'base64' })
  ).toBeNull();
  expect(networkRequestTier({ url: 'https://api.openverse.org/v1/images/' })).toBe('api');
});
it.each([
  '127.0.0.1',
  '10.0.0.1',
  '169.254.169.254',
  '172.16.0.1',
  '192.168.0.1',
  '100.64.0.1',
  '224.0.0.1',
  '192.0.2.1',
  '198.18.0.1',
  '::1',
  '::ffff:127.0.0.1',
  'fe80::1',
  'fc00::1',
  '2001:db8::1',
])('私网与保留地址不连接 %s', (ip) => expect(publicNetworkAddress(ip)).toBe(false));
it('DNS 混有私网地址立即拒绝，不发请求', async () => {
  let called = false;
  const fetcher: typeof fetch = async () => {
    called = true;
    return new Response('x', { headers: { 'content-type': 'image/png' } });
  };
  await expect(
    requestNetwork(
      { url: 'https://photos.example/x', responseType: 'base64' },
      fetcher,
      async () => ['8.8.8.8', '10.0.0.1']
    )
  ).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
  expect(called).toBe(false);
});
it('图片重定向到私网拒绝，外域非图片类型也拒绝', async () => {
  const redirect: typeof fetch = async () =>
    new Response(null, { status: 302, headers: { location: 'https://10.0.0.1/x' } });
  await expect(
    requestNetwork({ url: 'https://photos.example/x', responseType: 'base64' }, redirect, publicDns)
  ).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
  const html: typeof fetch = async () =>
    new Response('<html/>', { headers: { 'content-type': 'text/html' } });
  await expect(
    requestNetwork({ url: 'https://photos.example/x', responseType: 'base64' }, html, publicDns)
  ).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
});
