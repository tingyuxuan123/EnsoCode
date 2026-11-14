import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadMarketIndex, parseMarketIndex } from './marketIndex';

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
};
const key = pair();
const other = pair();

const compatibility = (over: Record<string, unknown> = {}) => ({
  host: 'collabra',
  apiVersion: 1,
  minAppVersion: '0.2.80',
  platforms: ['darwin', 'win32', 'linux'],
  testedSurfaces: [],
  ...over,
});
const version = (over: Record<string, unknown> = {}) => ({
  version: '1.0.0',
  permissions: ['ui.view'],
  path: 'packages/collabra.paper/1.0.0.zip',
  sha256: 'a'.repeat(64),
  size: 100,
  publishedAt: '2026-11-01T00:00:00Z',
  compatibility: compatibility(),
  ...over,
});
const plugin = (over: Record<string, unknown> = {}) => ({
  id: 'collabra.paper',
  name: 'Paper',
  description: '主题',
  tier: 'official',
  tags: ['theme'],
  versions: [version()],
  ...over,
});
const index = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  marketId: 'collabra',
  generatedAt: '2026-11-02T00:00:00Z',
  sequence: 5,
  plugins: [plugin()],
  ...over,
});
const signed = (value: unknown, privateKey = key.privateKey) => {
  const bytes = Buffer.from(JSON.stringify(value));
  return { bytes, signature: sign(null, bytes, privateKey).toString('base64') };
};
const host = { hostVersion: '0.2.80', platform: 'darwin' };

describe('loadMarketIndex', () => {
  it('签名正确时返回解析结果', () => {
    const r = loadMarketIndex({
      ...signed(index()),
      publicKeys: [key.publicPem],
      minSequence: 0,
      ...host,
    });
    expect(r.ok && r.index.sequence).toBe(5);
    expect(r.ok && r.index.marketId).toBe('collabra');
    expect(r.ok && r.index.plugins.map((p) => p.id)).toEqual(['collabra.paper']);
  });

  it('任一内置公钥通过即可（支持轮换）', () => {
    const r = loadMarketIndex({
      ...signed(index()),
      publicKeys: [other.publicPem, key.publicPem],
      minSequence: 0,
      ...host,
    });
    expect(r.ok).toBe(true);
  });

  it('篡改内容、错误公钥、缺失或乱码签名均拒绝', () => {
    const s = signed(index());
    const tampered = Buffer.from(s.bytes);
    tampered[tampered.length - 2] ^= 1;
    const base = { publicKeys: [key.publicPem], minSequence: 0, ...host };
    expect(loadMarketIndex({ ...base, bytes: tampered, signature: s.signature }).ok).toBe(false);
    expect(loadMarketIndex({ ...base, ...s, publicKeys: [other.publicPem] }).ok).toBe(false);
    expect(loadMarketIndex({ ...base, bytes: s.bytes, signature: '' }).ok).toBe(false);
    expect(loadMarketIndex({ ...base, bytes: s.bytes, signature: '!!!' }).ok).toBe(false);
  });

  it('sequence 小于已见值时拒绝（防回滚），等于时接受', () => {
    const s = signed(index({ sequence: 5 }));
    const base = { ...s, publicKeys: [key.publicPem], ...host };
    expect(loadMarketIndex({ ...base, minSequence: 6 }).ok).toBe(false);
    expect(loadMarketIndex({ ...base, minSequence: 5 }).ok).toBe(true);
  });

  it('签名有效但不是合法 JSON、旧 schema 或别的市场都拒绝', () => {
    const bytes = Buffer.from('not json');
    const signature = sign(null, bytes, key.privateKey).toString('base64');
    const base = { publicKeys: [key.publicPem], minSequence: 0, ...host };
    expect(loadMarketIndex({ ...base, bytes, signature }).ok).toBe(false);
    expect(loadMarketIndex({ ...base, ...signed(index({ schemaVersion: 1 })) }).ok).toBe(false);
    expect(loadMarketIndex({ ...base, ...signed(index({ schemaVersion: 3 })) }).ok).toBe(false);
    expect(loadMarketIndex({ ...base, ...signed(index({ marketId: 'enso' })) }).ok).toBe(false);
    const { marketId: _gone, ...noMarket } = index();
    expect(loadMarketIndex({ ...base, ...signed(noMarket) }).ok).toBe(false);
  });
});

describe('parseMarketIndex', () => {
  const parse = (value: unknown, hostVersion = '0.2.80', platform = 'darwin') =>
    parseMarketIndex(value, { hostVersion, platform });

  it('非法条目只丢弃该条，不影响其他', () => {
    const r = parse(
      index({
        plugins: [
          plugin(),
          plugin({ id: 'Bad Id' }),
          plugin({ id: 'collabra.b', name: '' }),
          'x',
          plugin({ id: 'collabra.c', tier: 'vip' }),
        ],
      })
    );
    expect(r?.plugins.map((p) => p.id)).toEqual(['collabra.paper']);
  });

  it('重复 id 只保留第一个', () => {
    const r = parse(index({ plugins: [plugin(), plugin({ name: 'Dup' })] }));
    expect(r?.plugins).toHaveLength(1);
    expect(r?.plugins[0].name).toBe('Paper');
  });

  it('丢弃路径越界、哈希或大小不合法的版本', () => {
    const r = parse(
      index({
        plugins: [
          plugin({
            versions: [
              version({ version: '0.1.0', path: '../evil.zip' }),
              version({ version: '0.2.0', path: '/abs.zip' }),
              version({ version: '0.3.0', path: 'https://x/a.zip' }),
              version({ version: '0.4.0', sha256: 'zz' }),
              version({ version: '0.5.0', size: -1 }),
              version({ version: '0.6.0', path: 'a\\b.zip' }),
              version(),
            ],
          }),
        ],
      })
    );
    expect(r?.plugins[0].versions.map((v) => v.version)).toEqual(['1.0.0']);
  });

  it('缺失或不完整的 compatibility 视为不兼容，没有兼容版本的插件整体丢弃', () => {
    const r = parse(
      index({
        plugins: [
          plugin({ versions: [version({ compatibility: undefined })] }),
          plugin({
            id: 'collabra.noapi',
            versions: [version({ compatibility: compatibility({ apiVersion: undefined }) })],
          }),
          plugin({
            id: 'collabra.host',
            versions: [version({ compatibility: compatibility({ host: 'enso' }) })],
          }),
          plugin({
            id: 'collabra.str',
            versions: [version({ compatibility: compatibility({ apiVersion: '1' }) })],
          }),
          plugin({
            id: 'collabra.range',
            versions: [version({ compatibility: compatibility({ minAppVersion: '>=0.1.0' }) })],
          }),
          plugin({
            id: 'collabra.plat',
            versions: [version({ compatibility: compatibility({ platforms: [] }) })],
          }),
          plugin({
            id: 'collabra.surface',
            versions: [version({ compatibility: compatibility({ testedSurfaces: ['palette'] }) })],
          }),
          plugin({ id: 'collabra.ok' }),
        ],
      })
    );
    expect(r?.plugins.map((p) => p.id)).toEqual(['collabra.ok']);
  });

  it('插件版本必须是合法 semver，重复同版本视为歧义整条丢弃', () => {
    const dirty = parse(
      index({
        plugins: [
          plugin({ id: 'collabra.wat', versions: [version({ version: 'wat' })] }),
          plugin({ id: 'collabra.zero', versions: [version({ version: '01.0.0' })] }),
          plugin({
            id: 'collabra.dup',
            versions: [version({ version: '1.0.0' }), version({ version: '1.0.0' })],
          }),
          plugin({ id: 'collabra.pre', versions: [version({ version: '1.0.0-beta.1+build' })] }),
        ],
      })
    );
    expect(dirty?.plugins.map((p) => p.id)).toEqual(['collabra.pre']);
  });

  it('兼容版本号拒绝前导零等脏输入', () => {
    for (const bad of ['00.2.80', '0.02.80', '0.2.080', '0.2', 'v0.2.80', ' 0.2.80']) {
      const r = parse(
        index({
          plugins: [
            plugin({
              versions: [version({ compatibility: compatibility({ minAppVersion: bad }) })],
            }),
          ],
        })
      );
      expect(r?.plugins, bad).toHaveLength(0);
    }
    for (const bad of ['00.3.0', '0.3', 'latest']) {
      const r = parse(
        index({
          plugins: [
            plugin({
              versions: [
                version({
                  compatibility: compatibility({ minAppVersion: '0.2.80', maxAppVersion: bad }),
                }),
              ],
            }),
          ],
        })
      );
      expect(r?.plugins, bad).toHaveLength(0);
    }
  });

  it('testedSurfaces 是必填数组：缺失即不兼容，空数组合法', () => {
    const { testedSurfaces: _missing, ...withoutSurfaces } = compatibility();
    const missing = parse(
      index({
        plugins: [
          plugin({
            id: 'collabra.missing',
            versions: [version({ compatibility: withoutSurfaces })],
          }),
          plugin({ id: 'collabra.empty' }),
        ],
      })
    );
    expect(missing?.plugins.map((p) => p.id)).toEqual(['collabra.empty']);
    expect(missing?.plugins[0].versions[0].compatibility.testedSurfaces).toEqual([]);
    const notArray = parse(
      index({
        plugins: [
          plugin({
            versions: [version({ compatibility: compatibility({ testedSurfaces: 'code' }) })],
          }),
        ],
      })
    );
    expect(notArray?.plugins).toHaveLength(0);
  });

  it('宿主平台不在 platforms 里就不兼容', () => {
    const onlyWindows = index({
      plugins: [
        plugin({ versions: [version({ compatibility: compatibility({ platforms: ['win32'] }) })] }),
      ],
    });
    expect(parse(onlyWindows, '0.2.80', 'darwin')?.plugins).toHaveLength(0);
    expect(parse(onlyWindows, '0.2.80', 'win32')?.plugins).toHaveLength(1);
    expect(parse(onlyWindows, '0.2.80', 'freebsd')?.plugins).toHaveLength(0);
  });

  it('minAppVersion/maxAppVersion 是包含边界的三段版本，越界不兼容', () => {
    const entry = (min: string, max?: string) =>
      index({
        plugins: [
          plugin({
            versions: [
              version({
                compatibility: compatibility({
                  minAppVersion: min,
                  ...(max ? { maxAppVersion: max } : {}),
                }),
              }),
            ],
          }),
        ],
      });
    expect(parse(entry('0.2.80'), '0.2.80')?.plugins).toHaveLength(1);
    expect(parse(entry('0.2.79'), '0.2.80')?.plugins).toHaveLength(1);
    expect(parse(entry('0.2.81'), '0.2.80')?.plugins).toHaveLength(0);
    expect(parse(entry('0.2.80', '0.2.80'), '0.2.80')?.plugins).toHaveLength(1);
    expect(parse(entry('0.2.80', '0.2.79'), '0.2.80')?.plugins).toHaveLength(0);
    expect(parse(entry('0.2.80', '0.3.0'), '0.3.1')?.plugins).toHaveLength(0);
    expect(parse(entry('0.2.80', '0.3.0'), '0.3.0')?.plugins).toHaveLength(1);
  });

  it('选择最高兼容版本，而不是最高发布版本', () => {
    const r = parse(
      index({
        plugins: [
          plugin({
            versions: [
              version({ version: '1.5.0' }),
              version({
                version: '2.0.0',
                compatibility: compatibility({ minAppVersion: '9.0.0' }),
              }),
            ],
          }),
        ],
      })
    );
    expect(r?.plugins[0].versions.map((v) => v.version)).toEqual(['1.5.0']);
    expect(r?.plugins[0].latest).toBe('1.5.0');
  });

  it('兼容集合里取 semver 最大者，不信任索引里的 latest', () => {
    const r = parse(
      index({
        plugins: [
          plugin({
            latest: '9.9.9',
            versions: [
              version({ version: '1.2.0' }),
              version({ version: '1.10.0' }),
              version({
                version: '2.0.0',
                compatibility: compatibility({ minAppVersion: '9.0.0' }),
              }),
            ],
          }),
        ],
      })
    );
    expect(r?.plugins[0].latest).toBe('1.10.0');
  });

  it('最高发布版本不兼容时不提供 readme，避免文档与实际可安装版本不一致', () => {
    const readme = {
      path: 'packages/collabra.paper/2.0.0.readme.md',
      sha256: 'b'.repeat(64),
      size: 20,
    };
    const split = parse(
      index({
        plugins: [
          plugin({
            readme,
            versions: [
              version({ version: '1.0.0' }),
              version({
                version: '2.0.0',
                compatibility: compatibility({ minAppVersion: '9.0.0' }),
              }),
            ],
          }),
        ],
      })
    );
    expect(split?.plugins[0].latest).toBe('1.0.0');
    expect(split?.plugins[0].readme).toBeUndefined();
    const aligned = parse(index({ plugins: [plugin({ readme })] }));
    expect(aligned?.plugins[0].readme).toEqual(readme);
  });

  it('testedSurfaces 由所选版本带出，未知覆盖标记不合法', () => {
    const r = parse(
      index({
        plugins: [
          plugin({
            versions: [
              version({
                compatibility: compatibility({
                  testedSurfaces: ['code', 'settings'],
                }),
              }),
            ],
          }),
        ],
      })
    );
    expect(r?.plugins[0].versions[0].compatibility.testedSurfaces).toEqual(['code', 'settings']);
  });

  it('顶层结构不对返回 null', () => {
    expect(parse(null)).toBeNull();
    expect(parse(index({ sequence: -1 }))).toBeNull();
    expect(parse(index({ sequence: 1.5 }))).toBeNull();
    expect(parse(index({ plugins: {} }))).toBeNull();
  });

  it('合法 readme 保留，路径、哈希或大小不合法时只丢掉该字段', () => {
    const readme = {
      path: 'packages/collabra.paper/1.0.0.readme.md',
      sha256: 'b'.repeat(64),
      size: 20,
    };
    const ok = parse(index({ plugins: [plugin({ readme })] }));
    expect(ok?.plugins[0].readme).toEqual(readme);
    for (const bad of [
      { path: '../secret.md', sha256: 'b'.repeat(64), size: 20 },
      { path: '/abs.md', sha256: 'b'.repeat(64), size: 20 },
      { path: 'packages/a.md', sha256: 'zz', size: 20 },
      { path: 'packages/a.md', sha256: 'b'.repeat(64), size: 0 },
      { path: 'packages/a.md', sha256: 'b'.repeat(64), size: 256 * 1024 + 1 },
    ]) {
      const r = parse(index({ plugins: [plugin({ readme: bad })] }));
      expect(r?.plugins.map((p) => p.id)).toEqual(['collabra.paper']);
      expect(r?.plugins[0].readme).toBeUndefined();
    }
  });

  it('category 只认已知分类；screenshots 支持同源相对路径与 https、最多 6 张', () => {
    const ok = parse(
      index({
        plugins: [
          plugin({
            category: 'productivity',
            screenshots: [
              {
                url: 'https://tingyuxuan123.github.io/collabra-plugins/v1/media/a.png',
                alt: '看板',
              },
              { url: 'media/b.png', alt: '相对' },
              { url: 'http://cdn.example/b.png', alt: 'x' },
              { url: 'https://cdn.example/c.png' },
              'https://cdn.example/d.png',
            ],
          }),
        ],
      })
    );
    expect(ok?.plugins[0]).toMatchObject({
      category: 'productivity',
      screenshots: [
        { url: 'https://tingyuxuan123.github.io/collabra-plugins/v1/media/a.png', alt: '看板' },
        { url: 'media/b.png', alt: '相对' },
        { url: 'https://cdn.example/c.png', alt: '' },
      ],
    });
    const many = Array.from({ length: 8 }, (_, i) => ({ url: `media/${i}.png` }));
    expect(
      parse(index({ plugins: [plugin({ screenshots: many })] }))?.plugins[0].screenshots
    ).toHaveLength(6);
    const bad = parse(index({ plugins: [plugin({ category: 'games', screenshots: 'x' })] }));
    expect(bad?.plugins[0].category).toBeUndefined();
    expect(bad?.plugins[0].screenshots).toBeUndefined();
  });
});
