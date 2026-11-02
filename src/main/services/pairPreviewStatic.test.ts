import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { PAIR_PREVIEW_STATIC_ORIGIN } from './pairPreviewPolicy';
import {
  createPairPreviewServerFiles,
  createPairPreviewStaticFiles,
  PAIR_PREVIEW_RESOURCE_LIMIT,
} from './pairPreviewStatic';

let temp: string;
let root: string;
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'enso-pair-preview-'));
  root = join(temp, 'project');
  await mkdir(join(root, 'pages'), { recursive: true });
  await writeFile(join(root, 'pages', 'index.html'), '<script src="../app.js"></script>');
  await writeFile(join(root, 'app.js'), 'window.preview = true;');
});
afterEach(async () => rm(temp, { recursive: true, force: true }));

const request = (path: string, init?: RequestInit) =>
  new Request(`${PAIR_PREVIEW_STATIC_ORIGIN}${path}`, init);

it('保留入口相对目录，返回白名单 MIME 和隔离响应头，绝不列目录', async () => {
  const files = await createPairPreviewStaticFiles(root, join(root, 'pages', 'index.html'));
  expect(files.entryPath).toBe('/pages/index.html');
  const html = await files.respond(request(files.entryPath));
  expect(html.status).toBe(200);
  expect(html.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  expect(html.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(html.headers.get('Cache-Control')).toBe('no-store');
  expect(await html.text()).toContain('../app.js');
  const script = await files.respond(request('/app.js?v=1'));
  expect(script.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8');
  expect(await script.text()).toBe('window.preview = true;');
  expect((await files.respond(request('/pages/'))).status).toBe(404);
  files.close();
});

it('拒绝根外入口、符号链接逃逸以及根目录被调包', async () => {
  const outside = join(temp, 'outside.html');
  await writeFile(outside, 'secret');
  await expect(createPairPreviewStaticFiles(root, outside)).rejects.toThrow();
  await symlink(outside, join(root, 'escape.html'));
  await expect(createPairPreviewStaticFiles(root, join(root, 'escape.html'))).rejects.toThrow();
  const files = await createPairPreviewStaticFiles(root, join(root, 'pages', 'index.html'));
  expect((await files.respond(request('/escape.html'))).status).toBe(404);
  await rm(root, { recursive: true });
  await mkdir(join(temp, 'replacement'));
  await writeFile(join(temp, 'replacement', 'app.js'), 'secret');
  await symlink(join(temp, 'replacement'), root);
  expect((await files.respond(request('/app.js'))).status).toBe(404);
  files.close();
});

it('每次读取重新校验链接，拒绝目录链接逃逸和秘密/服务端源码', async () => {
  const files = await createPairPreviewStaticFiles(root, join(root, 'pages', 'index.html'));
  await writeFile(join(temp, 'secret.js'), 'private');
  await rm(join(root, 'app.js'));
  await symlink(join(temp, 'secret.js'), join(root, 'app.js'));
  await symlink(temp, join(root, 'linked'));
  expect((await files.respond(request('/app.js'))).status).toBe(404);
  expect((await files.respond(request('/linked/secret.js'))).status).toBe(404);
  for (const name of ['.env', 'server.ts', 'server.py', 'credentials.json', 'private.pem']) {
    await writeFile(join(root, name), 'SECRET');
    expect((await files.respond(request(`/${name}`))).status).toBe(404);
  }
  for (const path of [
    '/%252e%252e/outside.html',
    '/%2fetc/passwd',
    '/.git/config',
    '/node_modules/a.js',
  ]) {
    expect((await files.respond(request(path))).status).toBe(404);
  }
  files.close();
});

it('8MiB 资源读取有硬上限，HEAD 无正文且不接受 POST 或远端 URL', async () => {
  const files = await createPairPreviewStaticFiles(root, join(root, 'pages', 'index.html'));
  await writeFile(join(root, 'large.wasm'), Buffer.alloc(PAIR_PREVIEW_RESOURCE_LIMIT + 1));
  expect((await files.respond(request('/large.wasm'))).status).toBe(413);
  const head = await files.respond(request('/app.js', { method: 'HEAD' }));
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  expect((await files.respond(request('/app.js', { method: 'POST' }))).status).toBe(405);
  expect((await files.respond(new Request('http://evil.com/app.js'))).status).toBe(403);
  files.close();
  expect((await files.respond(request('/app.js'))).status).toBe(410);
});

it('静态 HTML 入口必须是可读普通 HTML 文件', async () => {
  await expect(createPairPreviewStaticFiles(root, join(root, 'app.js'))).rejects.toThrow();
  await expect(createPairPreviewStaticFiles(root, join(root, 'pages'))).rejects.toThrow();
  await expect(createPairPreviewStaticFiles(root, join(root, 'missing.html'))).rejects.toThrow();
});

it.each(['dist', 'build'])(
  '构建产物 %s/index.html 的根绝对资源映射到产物目录且不暴露项目兄弟资源',
  async (output) => {
    const outputRoot = join(root, output);
    await mkdir(join(outputRoot, 'assets'), { recursive: true });
    await writeFile(
      join(outputRoot, 'index.html'),
      '<script type="module" src="/assets/app.js"></script>'
    );
    await writeFile(join(outputRoot, 'assets', 'app.js'), 'window.built = true;');
    const files = await createPairPreviewStaticFiles(root, join(outputRoot, 'index.html'));
    expect(files.entryPath).toBe('/index.html');
    const script = await files.respond(request('/assets/app.js'));
    expect(script.status).toBe(200);
    expect(await script.text()).toBe('window.built = true;');
    expect((await files.respond(request('/app.js'))).status).toBe(404);
    await symlink(join(root, 'app.js'), join(outputRoot, 'escape.js'));
    expect((await files.respond(request('/escape.js'))).status).toBe(404);
    files.close();
  }
);

it('构建入口缩小挂载前仍检查原授权根，产物目录调包后不再提供文件', async () => {
  const outside = join(temp, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'index.html'), 'secret');
  await symlink(outside, join(root, 'dist'));
  await expect(
    createPairPreviewStaticFiles(root, join(root, 'dist', 'index.html'))
  ).rejects.toThrow();
  await rm(join(root, 'dist'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist', 'index.html'), 'safe');
  const files = await createPairPreviewStaticFiles(root, join(root, 'dist', 'index.html'));
  await rm(join(root, 'dist'), { recursive: true });
  await symlink(outside, join(root, 'dist'));
  expect((await files.respond(request('/index.html'))).status).toBe(404);
  files.close();
});

it('Vite @fs 仅放行根内前端资源及从项目解析出的唯一 env.mjs，不开放依赖目录', async () => {
  const origin = 'http://127.0.0.1:5173/';
  const vite = join(temp, 'store', 'vite');
  await mkdir(join(vite, 'dist', 'client'), { recursive: true });
  await writeFile(join(vite, 'package.json'), JSON.stringify({ name: 'vite', version: '7.0.0' }));
  await writeFile(join(vite, 'dist', 'client', 'env.mjs'), 'export const env = {};');
  await writeFile(join(vite, 'dist', 'client', 'other.mjs'), 'SECRET');
  await mkdir(join(root, 'node_modules'));
  await symlink(vite, join(root, 'node_modules', 'vite'));
  await writeFile(join(root, 'App.tsx'), 'export default function App() {}');
  const authority = await createPairPreviewServerFiles(root, origin);
  const fsUrl = (path: string) => `${origin}@fs${path}`;
  expect(await authority.allowsRequest(fsUrl(join(root, 'App.tsx')), 'script')).toBe(true);
  expect(
    await authority.allowsRequest(fsUrl(join(vite, 'dist', 'client', 'env.mjs')), 'script')
  ).toBe(true);
  expect(
    await authority.allowsRequest(fsUrl(join(vite, 'dist', 'client', 'other.mjs')), 'script')
  ).toBe(false);
  await writeFile(join(root, 'credentials.json'), 'SECRET');
  expect(await authority.allowsRequest(fsUrl(join(root, 'credentials.json')), 'xhr')).toBe(false);
  expect(await authority.allowsRequest(fsUrl(join(root, 'App.tsx')), 'mainFrame')).toBe(false);
  expect(await authority.allowsRequest(fsUrl(join(root, 'App.tsx')), 'subFrame')).toBe(false);
  await rm(join(root, 'App.tsx'));
  await writeFile(join(temp, 'outside.tsx'), 'SECRET');
  await symlink(join(temp, 'outside.tsx'), join(root, 'App.tsx'));
  expect(await authority.allowsRequest(fsUrl(join(root, 'App.tsx')), 'script')).toBe(false);
  authority.close();
  expect(
    await authority.allowsRequest(fsUrl(join(vite, 'dist', 'client', 'env.mjs')), 'script')
  ).toBe(false);
});
