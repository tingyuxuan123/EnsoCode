import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_IMAGE_PROVIDER,
  type ImageProviderResult,
  type ImageProviderSettings,
  type ImageProviderView,
  normalizeImageProviderBaseUrl,
  parseImageProviderPatch,
  parseImageProviderSettings,
} from '@shared/imageProvider';

/**
 * 独立图片服务配置（对齐 Vetta 插件）：地址、模型列表、图生图开关、输出参数都归自己，
 * 不再借聊天 provider。密钥只以 safeStorage 密文的 base64 落盘，绝不进 settings.json。
 *
 * 边界：
 * - 只有宿主注入的 `file` 所在目录是唯一可写根，目录必须是真实存在的普通目录；
 *   文件必须是普通文件（拒绝符号链接 / 目录 / 设备），大小上限 128KiB。
 * - 写入走同目录随机 tmp + rename，权限 0600，失败只清自己的 tmp。
 * - 坏 JSON、坏密文、钥匙串不可用一律 fail closed：读写都报错，不覆盖既有文件。
 * - 缓存只在成功原子写入后更新；view 永不携带密钥或密文，`secret()` 仅供 Main 使用。
 * - 换到新 endpoint（规范化地址真实变更）即丢弃旧 key，不把旧凭证借给新地址。
 */

const MAX_FILE_BYTES = 128 * 1024;
const MAX_API_KEY_CHARS = 4096;
const MAX_ERROR_CHARS = 300;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export interface ImageProviderStoreOptions {
  file: string;
  encryptionAvailable: () => boolean;
  encrypt: (text: string) => Buffer;
  decrypt: (buffer: Buffer) => string;
}

interface Persisted {
  version: 1;
  config: ImageProviderSettings;
  apiKey: string | null;
}

interface State {
  configured: boolean;
  config: ImageProviderSettings;
  apiKey: string | null;
}

const ok = <T>(value: T): ImageProviderResult<T> => ({ ok: true, value });
const fail = <T>(error: string): ImageProviderResult<T> => ({
  ok: false,
  error: error.slice(0, MAX_ERROR_CHARS),
});

function cloneSettings(value: ImageProviderSettings): ImageProviderSettings {
  return { ...value, models: [...value.models] };
}

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class ImageProviderStore {
  private readonly file: string;
  private readonly encryptionAvailable: () => boolean;
  private readonly encrypt: (text: string) => Buffer;
  private readonly decrypt: (buffer: Buffer) => string;
  private cache: State | null = null;

  constructor(options: ImageProviderStoreOptions) {
    this.file = options.file;
    this.encryptionAvailable = options.encryptionAvailable;
    this.encrypt = options.encrypt;
    this.decrypt = options.decrypt;
  }

  read(): ImageProviderResult<ImageProviderView> {
    const state = this.load();
    if (!state.ok) return state;
    return ok(this.view(state.value));
  }

  update(patch: unknown): ImageProviderResult<ImageProviderView> {
    const parsed = parseImageProviderPatch(patch);
    if (!parsed) return fail('图片服务配置无效。');
    const current = this.load();
    if (!current.ok) return current;
    const merged = parseImageProviderSettings({ ...current.value.config, ...parsed });
    if (!merged) return fail('图片服务配置无效。');
    const before = normalizeImageProviderBaseUrl(current.value.config.baseUrl);
    const after = normalizeImageProviderBaseUrl(merged.baseUrl);
    const apiKey = before === after ? current.value.apiKey : null;
    const next: State = { configured: true, config: merged, apiKey };
    const written = this.persist(next);
    return written.ok ? ok(this.view(written.value)) : written;
  }

  setApiKey(key: unknown): ImageProviderResult<ImageProviderView> {
    if (key !== null && typeof key !== 'string') return fail('API Key 必须是字符串或 null。');
    const current = this.load();
    if (!current.ok) return current;
    let apiKey: string | null = null;
    if (typeof key === 'string') {
      const trimmed = key.trim();
      if (!trimmed) return fail('API Key 不能为空。');
      if (trimmed.length > MAX_API_KEY_CHARS) return fail('API Key 过长。');
      if (!this.safeEncryptionAvailable()) {
        return fail('系统钥匙串不可用，无法加密保存 API Key。');
      }
      try {
        const encrypted = this.encrypt(trimmed);
        if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) {
          return fail('无法加密保存 API Key。');
        }
        apiKey = encrypted.toString('base64');
      } catch {
        return fail('无法加密保存 API Key。');
      }
    }
    const next: State = { configured: true, config: current.value.config, apiKey };
    const written = this.persist(next);
    return written.ok ? ok(this.view(written.value)) : written;
  }

  /** 只给 Main 用：带明文的读取入口，任何异常或缺失都返回 null。 */
  secret(): { config: ImageProviderSettings; apiKey: string } | null {
    const state = this.load();
    if (!state.ok || !state.value.apiKey) return null;
    try {
      const apiKey = this.decrypt(Buffer.from(state.value.apiKey, 'base64'));
      if (typeof apiKey !== 'string' || !apiKey) return null;
      return { config: cloneSettings(state.value.config), apiKey };
    } catch {
      return null;
    }
  }

  private view(state: State): ImageProviderView {
    return {
      configured: state.configured,
      config: cloneSettings(state.config),
      hasApiKey: Boolean(state.apiKey),
      secureStorageAvailable: this.safeEncryptionAvailable(),
    };
  }

  private safeEncryptionAvailable(): boolean {
    try {
      return this.encryptionAvailable() === true;
    } catch {
      return false;
    }
  }

  private load(): ImageProviderResult<State> {
    if (this.cache) {
      if (this.cache.apiKey) {
        try {
          if (!this.decrypt(Buffer.from(this.cache.apiKey, 'base64')))
            return fail('图片服务密钥不可用。');
        } catch {
          return fail('图片服务密钥不可用。');
        }
      }
      if (this.cache.apiKey && !this.safeEncryptionAvailable())
        return fail('系统钥匙串不可用，无法读取已保存的 API Key。');
      return ok(this.cache);
    }
    const loaded = this.readFile();
    if (!loaded.ok) return loaded;
    this.cache = loaded.value;
    return loaded;
  }

  private readFile(): ImageProviderResult<State> {
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return ok({
          configured: false,
          config: cloneSettings(DEFAULT_IMAGE_PROVIDER),
          apiKey: null,
        });
      }
      return fail('无法读取图片服务配置。');
    }
    if (stats.isSymbolicLink() || !stats.isFile()) {
      return fail('图片服务配置不是常规文件，已拒绝读取。');
    }
    if (stats.size > MAX_FILE_BYTES) return fail('图片服务配置超过大小上限，已拒绝读取。');
    let raw: Buffer;
    try {
      raw = this.readBounded();
    } catch {
      return fail('无法读取图片服务配置。');
    }
    return this.decode(raw);
  }

  private readBounded(): Buffer {
    const before = lstatSync(this.file);
    const fd = openSync(
      this.file,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
    );
    try {
      const stats = fstatSync(fd);
      if (
        !stats.isFile() ||
        stats.size > MAX_FILE_BYTES ||
        before.dev !== stats.dev ||
        before.ino !== stats.ino ||
        before.isSymbolicLink()
      ) {
        throw new Error('unsafe image provider file');
      }
      const buffer = Buffer.alloc(stats.size);
      let offset = 0;
      while (offset < buffer.length) {
        const read = readSync(fd, buffer, offset, buffer.length - offset, offset);
        if (read <= 0) break;
        offset += read;
      }
      const after = fstatSync(fd);
      if (
        offset !== stats.size ||
        after.size !== stats.size ||
        after.mtimeMs !== stats.mtimeMs ||
        after.ctimeMs !== stats.ctimeMs
      )
        throw new Error('image provider file changed while reading');
      return buffer.subarray(0, offset);
    } finally {
      closeSync(fd);
    }
  }

  private decode(raw: Buffer): ImageProviderResult<State> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      return fail('图片服务配置已损坏，已拒绝读取。');
    }
    if (!isRow(parsed)) return fail('图片服务配置已损坏，已拒绝读取。');
    if (
      parsed.version !== 1 ||
      Object.keys(parsed).some((key) => !['version', 'config', 'apiKey'].includes(key))
    )
      return fail('图片服务配置格式不受支持，已拒绝读取。');
    const config = parseImageProviderSettings(parsed.config);
    if (!config) return fail('图片服务配置已损坏，已拒绝读取。');
    let apiKey: string | null = null;
    if (parsed.apiKey !== null && parsed.apiKey !== undefined) {
      const stored = parsed.apiKey;
      if (
        typeof stored !== 'string' ||
        stored.length === 0 ||
        stored.length > MAX_FILE_BYTES ||
        stored.length % 4 !== 0 ||
        !BASE64_PATTERN.test(stored)
      ) {
        return fail('图片服务密钥已损坏，已拒绝读取。');
      }
      apiKey = stored;
    }
    if (apiKey && !this.safeEncryptionAvailable()) {
      return fail('系统钥匙串不可用，无法读取已保存的 API Key。');
    }
    if (apiKey) {
      // 密文必须在读的时候就解一次，坏密文不能带着“有密钥”的假象进内存。
      try {
        const plain = this.decrypt(Buffer.from(apiKey, 'base64'));
        if (typeof plain !== 'string' || !plain) throw new Error('empty secret');
      } catch {
        return fail('图片服务密钥已损坏，已拒绝读取。');
      }
    }
    return ok({ configured: true, config, apiKey });
  }

  private persist(next: State): ImageProviderResult<State> {
    try {
      this.write(next);
    } catch {
      return fail('无法保存图片服务配置。');
    }
    this.cache = next;
    return ok(next);
  }

  private write(next: State): void {
    const dir = path.dirname(this.file);
    const dirStats = lstatSync(dir);
    if (dirStats.isSymbolicLink() || !dirStats.isDirectory()) {
      throw new Error('image provider dir is not a real directory');
    }
    // 固定根只看紧邻父目录：不接受借符号链接把写入带到别处，也不自动 mkdir 嵌套目录。
    try {
      const existing = lstatSync(this.file);
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw new Error('image provider file is not a regular file');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const payload: Persisted = { version: 1, config: next.config, apiKey: next.apiKey };
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    if (data.length > MAX_FILE_BYTES) throw new Error('image provider file too large');
    const tmp = path.join(dir, `.${path.basename(this.file)}.${randomUUID()}.tmp`);
    try {
      writeFileSync(tmp, data, { mode: 0o600, flag: 'wx' });
      renameSync(tmp, this.file);
    } catch (error) {
      try {
        unlinkSync(tmp);
      } catch {}
      throw error;
    }
  }
}
