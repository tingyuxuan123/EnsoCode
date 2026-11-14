import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MARKET_SITE_ORIGIN, marketIconUrl } from './market';

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

describe('市场图片地址', () => {
  it('相对路径解析到自有 Pages 市场的 v1/ 下，CSP 只额外放行这一个源', () => {
    expect(marketIconUrl('media/paper.png')).toBe(
      'https://tingyuxuan123.github.io/collabra-plugins/v1/media/paper.png'
    );
    expect(marketIconUrl('v1/media/paper.png')).toBe(
      'https://tingyuxuan123.github.io/collabra-plugins/v1/media/paper.png'
    );
    expect(marketIconUrl('https://tingyuxuan123.github.io/collabra-plugins/v1/media/a.png')).toBe(
      'https://tingyuxuan123.github.io/collabra-plugins/v1/media/a.png'
    );
    expect(MARKET_SITE_ORIGIN).toBe('https://tingyuxuan123.github.io');

    const img = directives().get('img-src') ?? [];
    expect(img).toContain(MARKET_SITE_ORIGIN);
    expect(img).toContain('https://tingyuxuan123.github.io');
    // 只多出这一个图片源：没有 scheme 通配、没有 http、没有其他外网来源
    expect(img.filter((source) => /^[a-z][a-z0-9+.-]*:\/\//.test(source))).toEqual([
      MARKET_SITE_ORIGIN,
    ]);
    expect(img).not.toContain('https:');
    expect(img.filter((source) => source.startsWith('http:'))).toEqual([]);
    // 本页 blob: 设计截图卡和 local-image: 通道仍然保留
    expect(img).toEqual(
      expect.arrayContaining(["'self'", 'data:', 'blob:', 'local-image:', MARKET_SITE_ORIGIN])
    );
  });

  it('旧 Worker 代理与镜像域名的图片一律拒绝，不扩大 renderer 允许域', () => {
    for (const hostile of [
      'https://enso-plugins.j3.do/v1/icon?url=x',
      'https://raw.githubusercontent.com/tingyuxuan123/collabra-plugins/dist/v1/media/a.png',
      'https://cdn.jsdelivr.net/gh/tingyuxuan123/collabra-plugins@dist/v1/media/a.png',
      'https://evil.example.test/icon.png',
      'https://tingyuxuan123.github.io.evil.test/x.png',
      'https://tingyuxuan123.github.io@evil.test/x.png',
      'https://tingyuxuan123.github.io/other-project/v1/a.png',
      'https://tingyuxuan123.github.io/collabra-plugins/v1/../../etc/passwd',
      'http://insecure.example.test/icon.png',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:image/svg+xml,<svg/>',
      '//cdn.example.test/icon.png',
      '',
    ])
      expect(marketIconUrl(hostile)).toBeUndefined();
    expect(marketIconUrl(undefined)).toBeUndefined();
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
});
