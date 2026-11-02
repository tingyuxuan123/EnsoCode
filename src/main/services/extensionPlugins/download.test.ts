import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ArchiveFetch,
  downloadPluginArchive,
  isPublicAddress,
  resolvePublicAddresses,
} from './download';

const roots: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'enso-download-'));
  roots.push(d);
  return d;
};
afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});
const body = (b: Buffer) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(b);
      c.close();
    },
  });

describe('下载地址安全策略', () => {
  it('明文 HTTP 在解析 DNS 或连接之前拒绝', async () => {
    let connected = false;
    await expect(
      downloadPluginArchive(new URL('http://public.example/x'), join(temp(), 'x'), {
        maxBytes: 10,
        resolve: async () => {
          connected = true;
          return [{ address: '8.8.8.8', family: 4 }];
        },
      })
    ).rejects.toThrow();
    expect(connected).toBe(false);
  });
  it('拒绝私有、环回、链路本地和 IPv4-mapped IPv6', () => {
    for (const ip of [
      '0.0.0.0',
      '10.0.0.1',
      '127.0.0.1',
      '169.254.1.1',
      '172.16.0.1',
      '192.168.0.1',
      '::1',
      'fc00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '0:0:0:0:0:ffff:7f00:1',
      'ff02::1',
      '2002:7f00:1::',
      '64:ff9b::7f00:1',
      '100::1',
    ])
      expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress('8.8.8.8')).toBe(true);
  });
  it('解析器的任一 A/AAAA 为私有时整体拒绝', async () => {
    await expect(resolvePublicAddresses('127.0.0.1')).rejects.toThrow(/内网/);
  });
  it('流式写入超限时中断并删除半截文件', async () => {
    const dest = join(temp(), 'plugin.zip');
    const fetchImpl: ArchiveFetch = async () => ({
      status: 200,
      headers: { get: () => null },
      body: body(Buffer.alloc(11)),
    });
    await expect(
      downloadPluginArchive(new URL('https://public.example/x'), dest, {
        fetch: fetchImpl,
        maxBytes: 10,
        resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      })
    ).rejects.toThrow(/过大/);
    expect(() => readFileSync(dest)).toThrow();
  });
  it('content-length 超限时读取正文前拒绝', async () => {
    let read = false;
    const dest = join(temp(), 'plugin.zip');
    await expect(
      downloadPluginArchive(new URL('https://public.example/x'), dest, {
        maxBytes: 10,
        resolve: async () => [{ address: '8.8.8.8', family: 4 }],
        fetch: async () => ({
          status: 200,
          headers: { get: () => '11' },
          body: {
            getReader: () => {
              read = true;
              throw new Error('read');
            },
          } as never,
        }),
      })
    ).rejects.toThrow(/过大/);
    expect(read).toBe(false);
  });
  it('redirect 限制协议、域名、凭证且 GitHub 允许其公开归档链', async () => {
    const seen: string[] = [];
    const fetchImpl: ArchiveFetch = async (url) => {
      seen.push(url);
      return seen.length === 1
        ? { status: 302, headers: { get: () => 'https://evil.example/x' }, body: null }
        : { status: 200, headers: { get: () => null }, body: body(Buffer.from('ok')) };
    };
    await expect(
      downloadPluginArchive(new URL('https://public.example/x'), join(temp(), 'a'), {
        maxBytes: 10,
        fetch: fetchImpl,
        resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      })
    ).rejects.toThrow(/重定向/);
    const githubFetch: ArchiveFetch = async (url) =>
      url.includes('api.github')
        ? { status: 302, headers: { get: () => 'https://codeload.github.com/x' }, body: null }
        : { status: 200, headers: { get: () => null }, body: body(Buffer.from('ok')) };
    const dest = join(temp(), 'b');
    await downloadPluginArchive(new URL('https://api.github.com/repos/a/b/zipball'), dest, {
      maxBytes: 10,
      fetch: githubFetch,
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    });
    expect(readFileSync(dest, 'utf8')).toBe('ok');
  });
  it('任何下载失败不能删除已存在的用户文件', async () => {
    const dest = join(temp(), 'existing');
    writeFileSync(dest, 'keep');
    await expect(
      downloadPluginArchive(new URL('https://public.example/x'), dest, {
        maxBytes: 10,
        resolve: async () => [{ address: '8.8.8.8', family: 4 }],
        fetch: async () => ({
          status: 200,
          headers: { get: () => null },
          body: body(Buffer.from('x')),
        }),
      })
    ).rejects.toThrow();
    expect(readFileSync(dest, 'utf8')).toBe('keep');
  });
  it('所有 DNS 结果检查后传给请求，不允许第二跳 DNS 重绑定', async () => {
    const seen: unknown[] = [];
    let count = 0;
    await expect(
      downloadPluginArchive(new URL('https://public.example/x'), join(temp(), 'x'), {
        maxBytes: 10,
        resolve: async () =>
          ++count === 1
            ? [{ address: '8.8.8.8', family: 4 }]
            : [
                { address: '8.8.8.8', family: 4 },
                { address: '127.0.0.1', family: 4 },
              ],
        fetch: async (_url, init) => {
          seen.push(init.addresses);
          return { status: 302, headers: { get: () => '/next' }, body: null };
        },
      })
    ).rejects.toThrow(/内网/);
    expect(seen).toEqual([[{ address: '8.8.8.8', family: 4 }]]);
  });
  it.each([
    'http://public.example/x',
    'https://user:secret@public.example/x',
    'https://public.example:444/x',
  ])('拒绝不安全 redirect %s', async (location) => {
    await expect(
      downloadPluginArchive(new URL('https://public.example/x'), join(temp(), 'x'), {
        maxBytes: 10,
        resolve: async () => [{ address: '8.8.8.8', family: 4 }],
        fetch: async () => ({ status: 302, headers: { get: () => location }, body: null }),
      })
    ).rejects.toThrow();
  });
});
