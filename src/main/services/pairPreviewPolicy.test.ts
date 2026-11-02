import { describe, expect, it } from 'vitest';
import {
  createPairPreviewNetworkPolicy,
  isPairPreviewPathAllowed,
  PAIR_PREVIEW_STATIC_ORIGIN,
  pairPreviewCsp,
  pairPreviewFsPath,
} from './pairPreviewPolicy';

describe('配对预览的封闭网络边界', () => {
  it('IPv6 CSP 使用浏览器接受的 self 与 ws scheme，实际连接仍受精确源网络策略约束', () => {
    const csp = pairPreviewCsp('http://[::1]:5173/');
    expect(csp).toContain("connect-src 'self' ws:;");
    expect(csp).not.toContain('[::1]');
    const policy = createPairPreviewNetworkPolicy('server', 'http://[::1]:5173/');
    expect(policy.allowsRequest('ws://[::1]:5173/', 'webSocket')).toBe(true);
    expect(policy.allowsRequest('ws://[::1]:5174/', 'webSocket')).toBe(false);
    expect(policy.allowsRequest('ws://example.com/', 'webSocket')).toBe(false);
    expect(pairPreviewCsp('http://127.0.0.1:5173/')).toContain(
      'connect-src http://127.0.0.1:5173 ws://127.0.0.1:5173;'
    );
  });
  it('静态页只访问私有源，不允许外网、LAN、文件、WebSocket 或外部协议', () => {
    const policy = createPairPreviewNetworkPolicy('html', '/nested/index.html');
    expect(policy.entryUrl).toBe(`${PAIR_PREVIEW_STATIC_ORIGIN}/nested/index.html`);
    expect(policy.allowsRequest(`${PAIR_PREVIEW_STATIC_ORIGIN}/assets/app.js?v=1`)).toBe(true);
    for (const url of [
      'https://cdn.example.com/app.js',
      'http://192.168.0.1/',
      'http://127.0.0.1:3000/',
      'http://enso-preview.invalid.evil.com/',
      'https://enso-preview.invalid/',
      'file:///etc/passwd',
      'ws://enso-preview.invalid/',
      'javascript:alert(1)',
      'mailto:a@example.com',
      'http://user:password@enso-preview.invalid/',
    ]) {
      expect(policy.allowsRequest(url), url).toBe(false);
      expect(policy.allowsNavigation(url), url).toBe(false);
    }
  });

  it('仅选择的数值 loopback 源及同端口 HMR 可达，WebSocket 不能当导航', () => {
    const policy = createPairPreviewNetworkPolicy('server', 'http://127.0.0.1:5173/demo');
    for (const path of [
      '/src/App.tsx',
      '/@vite/client',
      '/@react-refresh',
      '/@id/__x00__plugin-vue:export-helper',
      '/node_modules/.vite/deps/react.js?v=x',
    ]) {
      expect(policy.allowsRequest(`http://127.0.0.1:5173${path}`), path).toBe(true);
    }
    expect(policy.allowsRequest('ws://127.0.0.1:5173/?token=hmr', 'webSocket')).toBe(true);
    expect(policy.allowsNavigation('ws://127.0.0.1:5173/')).toBe(false);
    for (const url of [
      'http://localhost:5173/',
      'http://127.1:5173/',
      'http://2130706433:5173/',
      'http://127.0.0.1:5174/',
      'https://127.0.0.1:5173/',
      'ws://127.0.0.1:5174/',
      'http://127.0.0.1:5173@evil.com/',
    ])
      expect(policy.allowsRequest(url), url).toBe(false);
  });

  it('数值 IPv6 loopback 可作为唯一所选源，但其它 IPv6、IPv4 和同主机其它端口不可达', () => {
    const policy = createPairPreviewNetworkPolicy('server', 'http://[::1]:5173/');
    expect(policy.allowsRequest('http://[::1]:5173/src/App.vue', 'script')).toBe(true);
    expect(policy.allowsRequest('ws://[::1]:5173/?token=hmr', 'webSocket')).toBe(true);
    for (const raw of [
      'http://127.0.0.1:5173/',
      'http://[::1]:5174/',
      'http://[::2]:5173/',
      'http://[::ffff:127.0.0.1]:5173/',
      'http://[0:0:0:0:0:0:0:1]:5173/',
    ]) {
      expect(policy.allowsRequest(raw), raw).toBe(false);
    }
    expect(pairPreviewFsPath('http://[::1]:5173/@fs/tmp/app.js', policy.entryUrl)).toBe(
      '/tmp/app.js'
    );
  });

  it('不接受 DNS localhost、非规范 IP、凭据或非 HTTP 的开发服务器候选', () => {
    for (const url of [
      'http://localhost:3000/',
      'http://127.1:3000/',
      'http://2130706433:3000/',
      'https://127.0.0.1:3000/',
      'http://a@127.0.0.1:3000/',
      'http://127.0.0.1:99999/',
    ]) {
      expect(() => createPairPreviewNetworkPolicy('server', url), url).toThrow();
    }
  });

  it('data/blob 只可做子资源，不能导航或产生 iframe/worker', () => {
    const policy = createPairPreviewNetworkPolicy('html', '/index.html');
    expect(policy.allowsRequest('data:image/png;base64,AA==', 'image')).toBe(true);
    expect(policy.allowsRequest(`blob:${PAIR_PREVIEW_STATIC_ORIGIN}/id`, 'image')).toBe(true);
    expect(policy.allowsRequest('blob:https://evil.com/id', 'image')).toBe(false);
    expect(policy.allowsRequest('data:text/html,hello', 'subFrame')).toBe(false);
    expect(policy.allowsNavigation('data:text/html,hello')).toBe(false);
    expect(policy.allowsRequest(`${PAIR_PREVIEW_STATIC_ORIGIN}/index.html`, 'subFrame')).toBe(
      false
    );
    expect(policy.allowsRequest(`${PAIR_PREVIEW_STATIC_ORIGIN}/worker.js`, 'serviceWorker')).toBe(
      false
    );
  });

  it('遍历、重复编码、Vite 任意文件端点、秘密和依赖目录不因 URL 规范化漏过', () => {
    const policy = createPairPreviewNetworkPolicy('server', 'http://127.0.0.1:5173/');
    for (const path of [
      '/../outside.html',
      '/a/../secret.json',
      '/%2e%2e/secret.json',
      '/%252e%252e/secret.json',
      '/a%2fb.js',
      '/a%5cb.js',
      '/a\\b.js',
      '/%00.js',
      '/.git/config',
      '/.env',
      '/nested/.env.local',
      '/@fs/etc/passwd',
      '/%40fs/etc/passwd',
      '/@%66s/etc/passwd',
      '/@fs%2fetc/passwd',
      '/node_modules/secret/index.js',
      '/node_modules/.vite/deps/../../secret.js',
      '/credentials.json',
      '/server.js',
      '/src/main.server.js',
      '/vite.config.js',
      '/config/secret.json',
    ]) {
      expect(isPairPreviewPathAllowed(path, true), path).toBe(false);
      expect(policy.allowsRequest(`http://127.0.0.1:5173${path}`), path).toBe(false);
    }
    expect(isPairPreviewPathAllowed('/assets/hello%20world.js')).toBe(true);
    expect(isPairPreviewPathAllowed('/node_modules/.vite/deps/react.js', true)).toBe(true);
    expect(isPairPreviewPathAllowed('/.vite/deps/react.js', true)).toBe(true);
    expect(isPairPreviewPathAllowed('/node_modules/.vite/deps/react.js')).toBe(false);
  });

  it('Vite 文件路由仅解析所选数值 loopback 源，授权前不会解码遍历或重复编码', () => {
    const origin = 'http://127.0.0.1:5173/';
    expect(pairPreviewFsPath(`${origin}@fs/tmp/project/src/App.tsx?v=1`, origin)).toBe(
      '/tmp/project/src/App.tsx'
    );
    for (const raw of [
      'http://localhost:5173/@fs/tmp/app.js',
      'http://127.0.0.1:5174/@fs/tmp/app.js',
      `${origin}@fs/tmp/../secret.js`,
      `${origin}@fs/tmp/%252e%252e/secret.js`,
      `${origin}@fs/tmp%2fsecret.js`,
      `${origin}@fs/tmp/secret%00.js`,
    ]) {
      expect(pairPreviewFsPath(raw, origin), raw).toBeNull();
    }
  });
});
