import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_IMAGE_PROVIDER } from '@shared/imageProvider';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImageProviderStore, type ImageProviderStoreOptions } from './providerStore';

const KEY = 'sk-test-secret-abcdef';
const encrypt = (text: string) =>
  Buffer.concat([Buffer.from('enc:', 'utf8'), Buffer.from(text, 'utf8')]);
const decrypt = (buffer: Buffer) => {
  const raw = buffer.toString('utf8');
  if (!raw.startsWith('enc:')) throw new Error('bad ciphertext');
  return raw.slice(4);
};

const canChmod = process.platform !== 'win32' && process.getuid?.() !== 0;

let root: string;
let file: string;

function makeStore(overrides: Partial<ImageProviderStoreOptions> = {}): ImageProviderStore {
  return new ImageProviderStore({
    file,
    encryptionAvailable: () => true,
    encrypt,
    decrypt,
    ...overrides,
  });
}

function rawFile(): string {
  return readFileSync(file, 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'xiaoman-image-provider-'));
  file = path.join(root, 'image-provider.json');
});

afterEach(() => {
  try {
    chmodSync(root, 0o700);
  } catch {}
  rmSync(root, { recursive: true, force: true });
});

describe('独立图片服务配置存储', () => {
  it('缓存存在时钥匙串变为不可用，也不能继续返回密钥或已保存状态', () => {
    let available = true;
    const store = makeStore({ encryptionAvailable: () => available });
    expect(store.setApiKey(KEY).ok).toBe(true);
    available = false;
    expect(store.read().ok).toBe(false);
    expect(store.secret()).toBeNull();
  });
  it('read 不创建文件也不标 configured', () => {
    const store = makeStore();
    const result = store.read();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      configured: false,
      config: DEFAULT_IMAGE_PROVIDER,
      hasApiKey: false,
      secureStorageAvailable: true,
    });
    expect(existsSync(file)).toBe(false);
    expect(store.secret()).toBeNull();
  });

  it('update 只落非密配置，文件 0600 且不含 key', () => {
    const store = makeStore();
    const result = store.update({ models: ['gpt-image-2'], sizeMode: '2k', quality: 'high' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.configured).toBe(true);
    expect(result.value.config.models).toEqual(['gpt-image-2']);
    expect(result.value.config.sizeMode).toBe('2k');
    expect(result.value.config.quality).toBe('high');
    expect(result.value.hasApiKey).toBe(false);
    expect(rawFile()).not.toContain(KEY);
    expect(JSON.parse(rawFile()).config).toEqual(result.value.config);
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it('update 拒绝非法规格与明文 apiKey 字段', () => {
    const store = makeStore();
    for (const patch of [
      undefined,
      null,
      'nope',
      42,
      [],
      { apiKey: KEY },
      { models: [null] },
      { sizeMode: 'huge' },
      { baseUrl: 'file:///tmp/key' },
    ]) {
      expect(store.update(patch).ok).toBe(false);
    }
    expect(existsSync(file)).toBe(false);
  });

  it('setApiKey 加密保存，view 不暴露密钥或密文', () => {
    const store = makeStore();
    const result = store.setApiKey(KEY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hasApiKey).toBe(true);
    expect(result.value.configured).toBe(true);
    const view = JSON.stringify(result.value);
    const persisted = JSON.parse(rawFile()) as { apiKey: string };
    expect(view).not.toContain(KEY);
    expect(view).not.toContain(persisted.apiKey);
    expect(persisted.apiKey).not.toContain(KEY);
    expect(decrypt(Buffer.from(persisted.apiKey, 'base64'))).toBe(KEY);
    expect(store.secret()).toEqual({ config: DEFAULT_IMAGE_PROVIDER, apiKey: KEY });
    expect(rawFile()).not.toContain(KEY);
  });

  it('setApiKey(null) 清除密钥，undefined/空串/非字符串被拒且不改状态', () => {
    const store = makeStore();
    expect(store.setApiKey(KEY).ok).toBe(true);
    const before = rawFile();
    for (const bad of [undefined, '', '   ', 42, {}, ['x']]) {
      expect(store.setApiKey(bad).ok).toBe(false);
    }
    expect(rawFile()).toBe(before);
    const cleared = store.setApiKey(null);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.value.hasApiKey).toBe(false);
    expect(store.secret()).toBeNull();
    expect(rawFile()).not.toContain(KEY);
  });

  it('钥匙串不可用时不降级明文，已存密钥读也不能绕过', () => {
    const writable = makeStore();
    expect(writable.setApiKey(KEY).ok).toBe(true);
    const before = rawFile();
    const locked = makeStore({ encryptionAvailable: () => false });
    expect(locked.read().ok).toBe(false);
    expect(locked.setApiKey('sk-another-key').ok).toBe(false);
    expect(locked.update({ quality: 'low' }).ok).toBe(false);
    expect(rawFile()).toBe(before);
    expect(locked.secret()).toBeNull();
    const fresh = makeStore({
      encryptionAvailable: () => false,
      file: path.join(root, 'untouched.json'),
    });
    const result = fresh.setApiKey(KEY);
    expect(result.ok).toBe(false);
    expect(existsSync(path.join(root, 'untouched.json'))).toBe(false);
    const view = fresh.read();
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.value.secureStorageAvailable).toBe(false);
    expect(view.value.configured).toBe(false);
  });

  it('换 endpoint 清掉旧 key，等价地址保留 key', () => {
    const store = makeStore();
    expect(store.setApiKey(KEY).ok).toBe(true);
    const same = store.update({ baseUrl: ' https://api.openai.com/v1/ ' });
    expect(same.ok).toBe(true);
    if (!same.ok) return;
    expect(same.value.hasApiKey).toBe(true);
    expect(store.update({ models: ['gpt-image-2'] }).ok).toBe(true);
    expect(store.secret()?.apiKey).toBe(KEY);
    const moved = store.update({ baseUrl: 'https://images.example.com/v1' });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.hasApiKey).toBe(false);
    expect(store.secret()).toBeNull();
    expect(rawFile()).not.toContain(KEY);
    expect(store.update({ quality: 'high' }).ok).toBe(true);
    const reread = store.read();
    expect(reread.ok).toBe(true);
    if (reread.ok) expect(reread.value.hasApiKey).toBe(false);
  });

  it('坏 JSON / 非法字段读写都 fail closed 且不覆盖文件', () => {
    for (const payload of [
      '{not json',
      'null',
      '[]',
      JSON.stringify({ version: 1, config: { baseUrl: 'file:///x' }, apiKey: null }),
      JSON.stringify({ version: 1, config: DEFAULT_IMAGE_PROVIDER, apiKey: 'not base64!!' }),
      JSON.stringify({ version: 1, config: DEFAULT_IMAGE_PROVIDER, apiKey: 'AAAA' }),
    ]) {
      writeFileSync(file, payload);
      const store = makeStore();
      expect(store.read().ok).toBe(false);
      expect(store.update({ quality: 'high' }).ok).toBe(false);
      expect(store.setApiKey(KEY).ok).toBe(false);
      expect(store.secret()).toBeNull();
      expect(rawFile()).toBe(payload);
    }
  });

  it('超过 128KiB 的配置文件拒绝读取', () => {
    const payload = JSON.stringify({ version: 1, config: DEFAULT_IMAGE_PROVIDER, apiKey: null });
    writeFileSync(file, payload + ' '.repeat(129 * 1024));
    const store = makeStore();
    const result = store.read();
    expect(result.ok).toBe(false);
    expect(store.update({ quality: 'high' }).ok).toBe(false);
    expect(rawFile().length).toBe(payload.length + 129 * 1024);
  });

  it('符号链接与非常规文件一律拒绝读写', () => {
    const outside = path.join(root, 'outside.json');
    const outsidePayload = JSON.stringify({
      version: 1,
      config: DEFAULT_IMAGE_PROVIDER,
      apiKey: null,
    });
    writeFileSync(outside, outsidePayload);
    symlinkSync(outside, file);
    const store = makeStore();
    expect(store.read().ok).toBe(false);
    expect(store.update({ quality: 'high' }).ok).toBe(false);
    expect(store.setApiKey(KEY).ok).toBe(false);
    expect(readFileSync(outside, 'utf8')).toBe(outsidePayload);
    expect(lstatSync(file).isSymbolicLink()).toBe(true);

    rmSync(file);
    mkdirSync(file);
    expect(makeStore().read().ok).toBe(false);
    expect(makeStore().update({ quality: 'high' }).ok).toBe(false);
  });

  it('父目录必须是真实存在的固定根，不跟着符号链接写出去', () => {
    const real = path.join(root, 'real');
    mkdirSync(real);
    const link = path.join(root, 'linked');
    symlinkSync(real, link, 'dir');
    const linkedFile = path.join(link, 'image-provider.json');
    const store = makeStore({ file: linkedFile });
    expect(store.update({ quality: 'high' }).ok).toBe(false);
    expect(existsSync(path.join(real, 'image-provider.json'))).toBe(false);

    const missing = makeStore({ file: path.join(root, 'nested', 'image-provider.json') });
    expect(missing.update({ quality: 'high' }).ok).toBe(false);
    expect(existsSync(path.join(root, 'nested'))).toBe(false);
  });

  it.skipIf(!canChmod)('写入失败不留下自己的 tmp，也不改旧内容', () => {
    const store = makeStore();
    expect(store.update({ quality: 'high' }).ok).toBe(true);
    const before = rawFile();
    chmodSync(root, 0o500);
    try {
      expect(store.update({ quality: 'low' }).ok).toBe(false);
      expect(store.setApiKey(KEY).ok).toBe(false);
    } finally {
      chmodSync(root, 0o700);
    }
    expect(rawFile()).toBe(before);
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('缓存只在成功写入后更新', () => {
    const store = makeStore();
    expect(store.update({ quality: 'high' }).ok).toBe(true);
    const tampered = '{"broken"';
    writeFileSync(file, tampered);
    const cached = store.read();
    expect(cached.ok).toBe(true);
    if (!cached.ok) return;
    expect(cached.value.config.quality).toBe('high');
    expect(store.update({ quality: 'low' }).ok).toBe(true);
    expect(JSON.parse(rawFile()).config.quality).toBe('low');
  });
});
