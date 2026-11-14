import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BUILTIN_MARKET } from './builtinMarket';
import { marketPublicKeys } from './market';
import { loadMarketIndex } from './marketIndex';

const snapshot = () => {
  if (!BUILTIN_MARKET) throw new Error('内置市场快照缺失');
  return { bytes: Buffer.from(BUILTIN_MARKET.index), signature: BUILTIN_MARKET.signature };
};
const load = (over: { bytes?: Buffer; signature?: string } = {}, hostVersion = '0.2.80') =>
  loadMarketIndex({
    ...snapshot(),
    ...over,
    publicKeys: marketPublicKeys(),
    minSequence: 0,
    hostVersion,
    platform: 'darwin',
  });

describe('内置市场快照', () => {
  it('用生产公钥验签，是 v2 的 collabra 索引且 sequence 为 2', () => {
    expect(BUILTIN_MARKET).not.toBeNull();
    expect(marketPublicKeys()).toHaveLength(1);
    const r = load();
    if (!r.ok) throw new Error(r.error);
    expect(r.index.schemaVersion).toBe(2);
    expect(r.index.marketId).toBe('collabra');
    expect(r.index.sequence).toBe(2);
    expect(r.index.plugins.map((p) => p.id)).toEqual(['collabra.paper']);
    const paper = r.index.plugins[0];
    expect(paper.latest).toBe('1.0.0');
    expect(paper.versions[0]).toMatchObject({
      version: '1.0.0',
      permissions: [],
      path: 'packages/collabra.paper/1.0.0.zip',
      sha256: '830976b5b9c3426512e11d744228eab458afa8e65058d58efbd5fc3cc955d836',
      size: 4035,
      compatibility: {
        host: 'collabra',
        apiVersion: 1,
        minAppVersion: '0.2.80',
        platforms: ['darwin', 'win32', 'linux'],
        testedSurfaces: [],
      },
    });
  });

  it('宿主 0.2.80 的三个平台都能用这份快照', () => {
    const { bytes, signature } = snapshot();
    for (const platform of ['darwin', 'win32', 'linux']) {
      const r = loadMarketIndex({
        bytes,
        signature,
        publicKeys: marketPublicKeys(),
        minSequence: 0,
        hostVersion: '0.2.80',
        platform,
      });
      if (!r.ok) throw new Error(`${platform}: ${r.error}`);
      expect(r.index.plugins.map((p) => p.id)).toEqual(['collabra.paper']);
    }
  });

  it('篡改字节、错误签名或别的公钥一律拒绝', () => {
    const { bytes, signature } = snapshot();
    const tampered = Buffer.from(bytes);
    tampered[tampered.length - 2] ^= 1;
    expect(load({ bytes: tampered }).ok).toBe(false);
    expect(load({ signature: `${signature.slice(0, -3)}AAA=` }).ok).toBe(false);
    const other = generateKeyPairSync('ed25519')
      .publicKey.export({ type: 'spki', format: 'pem' })
      .toString();
    const foreign = loadMarketIndex({
      bytes,
      signature,
      publicKeys: [other],
      minSequence: 0,
      hostVersion: '0.2.80',
      platform: 'darwin',
    });
    expect(foreign.ok).toBe(false);
  });

  it('宿主版本低于 minAppVersion 时快照里的版本不兼容，但仍验签通过', () => {
    const r = load({}, '0.2.79');
    expect(r.ok).toBe(true);
    expect(r.ok && r.index.plugins).toHaveLength(0);
  });
});
