import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { marketIconUrl } from './market';

/** 主窗口是市场页唯一的宿主，策略直接读真实 index.html，不复制一份文案。 */
function directives(): Map<string, string[]> {
  const html = readFileSync(new URL('../../../renderer/index.html', import.meta.url), 'utf8');
  const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? '';
  const map = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) map.set(name, sources);
  }
  return map;
}

it('市场 icon 与截图只经 Worker 代理域名，主入口 CSP 只额外放行这一个图片源', () => {
  const proxied = marketIconUrl(
    'https://cdn.jsdelivr.net/gh/j3n5en/enso-plugins/enso.skyfighter.svg'
  );
  expect(proxied).toBeDefined();
  const origin = new URL(proxied as string).origin;
  expect(origin).toBe('https://enso-plugins.j3.do');

  const img = directives().get('img-src') ?? [];
  expect(img).toContain(origin);
  // 只多出代理域名：没有 scheme 通配、没有 http、没有其他外网来源
  expect(img.filter((source) => /^[a-z][a-z0-9+.-]*:\/\//.test(source))).toEqual([origin]);
  expect(img).not.toContain('https:');
  expect(img.filter((source) => source.startsWith('http:'))).toEqual([]);
  // 本页 blob: 设计截图卡和 local-image: 通道仍然保留
  expect(img).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:', 'local-image:', origin]));
});

it('代理只接受 https 图片地址，不扩大 scheme', () => {
  expect(marketIconUrl(undefined)).toBeUndefined();
  expect(marketIconUrl('http://insecure.example.test/icon.png')).toBeUndefined();
  for (const hostile of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:image/svg+xml,<svg/>',
    '//cdn.example.test/icon.png',
  ])
    expect(marketIconUrl(hostile)).toBeUndefined();
});

it('图片源之外的安全边界逐条不变', () => {
  const policy = directives();
  expect(policy.get('default-src')).toEqual(["'self'"]);
  expect(policy.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'", 'blob:']);
  expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
  expect(policy.get('font-src')).toEqual(["'self'", 'data:']);
  expect(policy.get('media-src')).toEqual(["'self'", 'local-image:']);
  expect(policy.get('connect-src')).toEqual(["'self'", 'local-image:']);
  expect(policy.get('worker-src')).toEqual(["'self'", 'blob:']);
  expect(policy.get('frame-src')).toEqual(["'self'", 'http://127.0.0.1:*']);
});
