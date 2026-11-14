import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ArchiveFetch, downloadPluginArchive, type ResolveAddresses } from './download';
import { loadMarketIndex, MARKET_ID, type MarketIndex } from './marketIndex';

export { MARKET_ID };

/**
 * 自有精选市场：主源是 GitHub Pages，其余是同一个市场（同一 marketId）的镜像。
 * 换镜像地址不改变市场身份，也不清空防回滚 sequence。
 */
export const MARKET_PAGES_BASE = 'https://tingyuxuan123.github.io/collabra-plugins/v1/';
const MARKET_RAW_BASE = 'https://raw.githubusercontent.com/tingyuxuan123/collabra-plugins/dist/v1/';
const MARKET_JSDELIVR_BASE = 'https://cdn.jsdelivr.net/gh/tingyuxuan123/collabra-plugins@dist/v1/';
/** 市场图片只允许自有站点；相对路径按市场 v1/ 解析，不放开任意 https */
export const MARKET_SITE_ORIGIN = 'https://tingyuxuan123.github.io';
const MARKET_SITE_PATH = '/collabra-plugins/v1/';

/** 生产签名公钥（SPKI PEM）；只信任这把，不再信任上游 key */
const MARKET_PUBLIC_KEYS: string[] = [
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA8d7tATk4T2mJ2vbSdVPNHIxClIctNMUwIsqboL5BRUQ=
-----END PUBLIC KEY-----`,
];

const INDEX_MAX_BYTES = 8 * 1024 * 1024;
const PACKAGE_MAX_BYTES = 200 * 1024 * 1024;
const SOURCE_TIMEOUT_MS = 10_000;
const PACKAGE_TIMEOUT_MS = 120_000;

export type MarketFetch = ArchiveFetch;

/** 主源 Pages 始终第一；国内镜像开启时 jsDelivr 先于 GitHub raw */
export function marketSources(chinaMirror: boolean): string[] {
  return [
    MARKET_PAGES_BASE,
    ...(chinaMirror
      ? [MARKET_JSDELIVR_BASE, MARKET_RAW_BASE]
      : [MARKET_RAW_BASE, MARKET_JSDELIVR_BASE]),
  ];
}

export function marketPublicKeys(): string[] {
  return MARKET_PUBLIC_KEYS;
}

/** 开发用源覆盖：名称带 COLLABRA_，只接受 https，签名仍只认生产公钥 */
export function envMarketSources(env: NodeJS.ProcessEnv): string[] | null {
  const list = env.COLLABRA_PLUGIN_MARKET?.split(',')
    .map((s) => s.trim())
    .filter((s) => /^https:\/\//.test(s))
    .map((s) => (s.endsWith('/') ? s : `${s}/`));
  return list && list.length > 0 ? list : null;
}

/**
 * 把索引里的图片地址解析成 renderer 可加载的地址：
 * 相对路径落在市场 v1/ 下，绝对地址必须是自有站点同一路径前缀，其余一律丢弃。
 */
export function marketIconUrl(icon: string | undefined): string | undefined {
  if (!icon || icon.length > 1000 || icon.includes('\\')) return undefined;
  let url: URL;
  try {
    // 索引里可能写 `media/x.png`（相对 v1/）或 `v1/media/x.png`（相对站点根）
    const base = icon.startsWith('v1/')
      ? `${MARKET_SITE_ORIGIN}/collabra-plugins/`
      : MARKET_PAGES_BASE;
    url = new URL(icon, base);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;
  if (url.username || url.password || url.port) return undefined;
  if (url.origin !== MARKET_SITE_ORIGIN) return undefined;
  if (!url.pathname.startsWith(MARKET_SITE_PATH)) return undefined;
  return url.href;
}

export interface PluginMarketOptions {
  /** 插件数据目录；市场状态放在 market/<marketId>/ 下 */
  root: string;
  /** 市场身份；缓存与防回滚 sequence 都以它为键 */
  marketId: string;
  fetch: MarketFetch;
  /** Collabra fork：DNS 结果必须校验并钉住连接；缺省用系统解析 */
  resolve?: ResolveAddresses;
  hostVersion: string;
  /** 宿主平台，缺省用 process.platform；测试可注入 */
  platform?: string;
  publicKeys: string[];
  sources?: (chinaMirror: boolean) => string[];
  /** 随安装包内置的已签名索引；必须是同一市场，签名与市场身份都校验 */
  builtin?: { index: string; signature: string } | null;
}

export type MarketIndexResult =
  | { ok: true; index: MarketIndex; stale: boolean }
  | { ok: false; error: string };

interface MarketState {
  maxSequence: number;
  chinaMirror: boolean;
}

export class PluginMarket {
  private current: { index: MarketIndex; stale: boolean } | null = null;
  private loading: Promise<MarketIndexResult> | null = null;

  constructor(private readonly options: PluginMarketOptions) {}

  get marketId(): string {
    return this.options.marketId;
  }

  get platform(): string {
    return this.options.platform ?? process.platform;
  }

  private get dir() {
    return join(this.options.root, 'market', this.options.marketId);
  }

  private readState(): MarketState {
    try {
      const raw = JSON.parse(readFileSync(join(this.dir, 'state.json'), 'utf8')) as unknown;
      const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
      return {
        maxSequence: Number.isSafeInteger(r.maxSequence) ? (r.maxSequence as number) : 0,
        chinaMirror: r.chinaMirror === true,
      };
    } catch {
      return { maxSequence: 0, chinaMirror: false };
    }
  }

  private writeState(patch: Partial<MarketState>) {
    mkdirSync(this.dir, { recursive: true });
    const file = join(this.dir, 'state.json');
    writeFileSync(`${file}.tmp`, JSON.stringify({ ...this.readState(), ...patch }));
    renameSync(`${file}.tmp`, file);
  }

  chinaMirror(): boolean {
    return this.readState().chinaMirror;
  }

  setChinaMirror(on: boolean): void {
    this.writeState({ chinaMirror: on });
  }

  private sources(): string[] {
    return (this.options.sources ?? marketSources)(this.chinaMirror());
  }

  private verify(bytes: Uint8Array, signature: string, minSequence: number) {
    return loadMarketIndex({
      bytes,
      signature,
      publicKeys: this.options.publicKeys,
      minSequence,
      hostVersion: this.options.hostVersion,
      platform: this.platform,
    });
  }

  private async fetchBytes(url: string, maxBytes: number): Promise<Buffer> {
    const tmp = join(this.dir, 'tmp', randomUUID());
    mkdirSync(join(this.dir, 'tmp'), { recursive: true });
    try {
      await downloadPluginArchive(new URL(url), tmp, {
        fetch: this.options.fetch,
        ...(this.options.resolve ? { resolve: this.options.resolve } : {}),
        maxBytes,
        timeoutMs: SOURCE_TIMEOUT_MS,
      });
      return await readFile(tmp);
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  /** 远端依次尝试 → 磁盘缓存 → 内置索引；均需验签且不早于本市场已见 sequence */
  index(options: { refresh?: boolean } = {}): Promise<MarketIndexResult> {
    if (this.current && !options.refresh) return Promise.resolve({ ok: true, ...this.current });
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async load(): Promise<MarketIndexResult> {
    if (this.options.publicKeys.length === 0)
      return { ok: false, error: '插件市场尚未配置签名公钥' };
    const { maxSequence } = this.readState();
    let lastError = '无法连接插件市场';
    for (const base of this.sources()) {
      try {
        const [bytes, sig] = await Promise.all([
          this.fetchBytes(`${base}index.json`, INDEX_MAX_BYTES),
          this.fetchBytes(`${base}index.json.sig`, 4096),
        ]);
        const r = this.verify(bytes, sig.toString('utf8'), maxSequence);
        if (!r.ok) {
          lastError = r.error;
          continue;
        }
        mkdirSync(this.dir, { recursive: true });
        writeFileSync(join(this.dir, 'index.json'), bytes);
        writeFileSync(join(this.dir, 'index.json.sig'), sig);
        this.writeState({ maxSequence: r.index.sequence });
        this.current = { index: r.index, stale: false };
        return { ok: true, ...this.current };
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
      }
    }
    const fallback = this.offline(maxSequence);
    if (fallback) {
      this.current = { index: fallback, stale: true };
      return { ok: true, ...this.current };
    }
    return { ok: false, error: lastError };
  }

  private offline(maxSequence: number): MarketIndex | null {
    const candidates: MarketIndex[] = [];
    try {
      const r = this.verify(
        readFileSync(join(this.dir, 'index.json')),
        readFileSync(join(this.dir, 'index.json.sig'), 'utf8'),
        maxSequence
      );
      if (r.ok) candidates.push(r.index);
    } catch {}
    const { builtin } = this.options;
    if (builtin) {
      const r = this.verify(Buffer.from(builtin.index), builtin.signature, maxSequence);
      if (r.ok) candidates.push(r.index);
    }
    return candidates.sort((a, b) => b.sequence - a.sequence)[0] ?? null;
  }

  /** 下载到 dest 并校验 sha256；某个源的包不符就换下一个源 */
  async download(
    id: string,
    version: string | undefined,
    dest: string,
    signal?: AbortSignal
  ): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
    if (signal?.aborted) return { ok: false, error: '下载已取消' };
    const r = await this.index();
    if (!r.ok) return r;
    const plugin = r.index.plugins.find((p) => p.id === id);
    if (!plugin) return { ok: false, error: `插件市场里没有 ${id}` };
    const entry = plugin.versions.find((v) => v.version === (version ?? plugin.latest));
    if (!entry)
      return {
        ok: false,
        error: `${id} 没有适配当前应用或平台的版本 ${version ?? ''}`.trim(),
      };
    let lastError = '无法下载插件';
    for (const base of this.sources()) {
      try {
        await downloadPluginArchive(new URL(entry.path, base), dest, {
          fetch: this.options.fetch,
          ...(this.options.resolve ? { resolve: this.options.resolve } : {}),
          maxBytes: Math.min(entry.size, PACKAGE_MAX_BYTES),
          timeoutMs: PACKAGE_TIMEOUT_MS,
          signal,
        });
        if ((await sha256File(dest)) === entry.sha256) return { ok: true, version: entry.version };
        lastError = '插件包校验失败';
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
      }
      rmSync(dest, { force: true });
    }
    return { ok: false, error: lastError };
  }

  async readme(id: string): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
    const r = await this.index();
    if (!r.ok) return r;
    const entry = r.index.plugins.find((plugin) => plugin.id === id)?.readme;
    if (!entry) return { ok: false, error: '没有使用说明' };
    let mismatch = false;
    let lastError = '无法下载使用说明';
    for (const base of this.sources()) {
      try {
        const bytes = await this.fetchBytes(new URL(entry.path, base).href, entry.size);
        if (bytes.byteLength > entry.size) {
          lastError = '使用说明过大';
          continue;
        }
        if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
          mismatch = true;
          lastError = '使用说明校验失败';
          continue;
        }
        return { ok: true, markdown: bytes.toString('utf8') };
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
      }
    }
    return { ok: false, error: mismatch ? '使用说明校验失败' : lastError };
  }
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}
