import { createPublicKey, verify } from 'node:crypto';
import {
  isNewerPluginVersion,
  isPluginId,
  isPluginRelativePath,
} from '@shared/extensionPlugins/manifest';
import {
  isMarketCategory,
  MAX_MARKET_SCREENSHOTS,
  type MarketCategory,
  type MarketScreenshot,
} from '@shared/extensionPlugins/marketCategories';

/** 冻结的市场协议：身份与版本号由 SPEC 决定，客户端只认这一套 */
export const MARKET_ID = 'collabra';
export const MARKET_SCHEMA_VERSION = 2;
export const MARKET_API_VERSION = 1;
export const MARKET_PLATFORMS = ['darwin', 'win32', 'linux'] as const;
export type MarketPlatform = (typeof MARKET_PLATFORMS)[number];
/** 只代表真实验证过的界面覆盖；不授予任何能力，也不代表调色板装饰已覆盖 */
export const MARKET_TESTED_SURFACES = [
  'code',
  'bot',
  'image-studio',
  'taskboard',
  'design',
  'settings',
] as const;
export type MarketSurface = (typeof MARKET_TESTED_SURFACES)[number];

export interface MarketCompatibility {
  host: typeof MARKET_ID;
  apiVersion: typeof MARKET_API_VERSION;
  /** 包含边界的三段发布版本；不支持任意 semver 范围 */
  minAppVersion: string;
  maxAppVersion?: string;
  platforms: MarketPlatform[];
  testedSurfaces: MarketSurface[];
}

export type MarketTier = 'official' | 'community';

export interface MarketVersion {
  version: string;
  permissions: string[];
  path: string;
  sha256: string;
  size: number;
  publishedAt?: string;
  compatibility: MarketCompatibility;
}

export interface MarketPlugin {
  id: string;
  name: string;
  description: string;
  tier: MarketTier;
  tags: string[];
  homepage?: string;
  /** 相对市场 v1/ 的安全路径或自有站点 https 地址；由 Main 解析成可加载地址 */
  icon?: string;
  category?: MarketCategory;
  screenshots?: MarketScreenshot[];
  readme?: { path: string; sha256: string; size: number };
  /** 当前宿主可用的最高兼容版本 */
  latest: string;
  /** 索引里实际发布的最高版本（可能因不兼容被排除），只用于判断元数据是否对得上 */
  newest: string;
  versions: MarketVersion[];
}

export interface MarketIndex {
  schemaVersion: typeof MARKET_SCHEMA_VERSION;
  marketId: typeof MARKET_ID;
  sequence: number;
  generatedAt: string;
  plugins: MarketPlugin[];
}

export interface MarketHost {
  hostVersion: string;
  platform: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => str(s, max)) : [];
const optStr = (v: unknown, max: number) => (str(v, max) ? v : undefined);
const README_MAX_BYTES = 256 * 1024;
/** 发布版本必须是严格三段整数，避免把范围表达式当成兼容性 */
const APP_VERSION = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
/** 插件版本按 semver 解析：脏字符串或前导零会让“最新版本”比较失去意义 */
const PLUGIN_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

type AppVersion = [number, number, number];
function parseAppVersion(value: unknown): AppVersion | null {
  if (typeof value !== 'string') return null;
  const match = APP_VERSION.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
function compareAppVersion(a: AppVersion, b: AppVersion): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
const isPlatform = (v: unknown): v is MarketPlatform =>
  (MARKET_PLATFORMS as readonly unknown[]).includes(v);
const isSurface = (v: unknown): v is MarketSurface =>
  (MARKET_TESTED_SURFACES as readonly unknown[]).includes(v);

/** 结构校验 + 归一化；任何缺失或非法字段都返回 null（不兼容），绝不默认通过 */
function parseCompatibility(raw: unknown): MarketCompatibility | null {
  if (!isRecord(raw)) return null;
  if (raw.host !== MARKET_ID) return null;
  if (raw.apiVersion !== MARKET_API_VERSION) return null;
  // 严格按发布版本字符串校验，不去空格：带空白的值视为非法
  const minAppVersion = str(raw.minAppVersion, 20) ? raw.minAppVersion : undefined;
  if (!minAppVersion || !parseAppVersion(minAppVersion)) return null;
  let maxAppVersion: string | undefined;
  if (raw.maxAppVersion !== undefined) {
    if (!str(raw.maxAppVersion, 20)) return null;
    maxAppVersion = raw.maxAppVersion;
    if (!parseAppVersion(maxAppVersion)) return null;
  }
  if (!Array.isArray(raw.platforms) || raw.platforms.length === 0) return null;
  const platforms: MarketPlatform[] = [];
  for (const item of raw.platforms) {
    if (!isPlatform(item)) return null;
    if (!platforms.includes(item)) platforms.push(item);
  }
  // 冻结协议要求必填；缺失不等于“未覆盖”，直接判为不兼容
  if (!Array.isArray(raw.testedSurfaces)) return null;
  const surfaces: MarketSurface[] = [];
  for (const item of raw.testedSurfaces) {
    if (!isSurface(item)) return null;
    if (!surfaces.includes(item)) surfaces.push(item);
  }
  return {
    host: MARKET_ID,
    apiVersion: MARKET_API_VERSION,
    minAppVersion,
    ...(maxAppVersion ? { maxAppVersion } : {}),
    platforms,
    testedSurfaces: surfaces,
  };
}

/** 单个版本的兼容性判断；缺失字段、非法值、平台或版本不符都返回 false */
export function isMarketCompatible(raw: unknown, host: MarketHost): boolean {
  const compatibility = parseCompatibility(raw);
  if (!compatibility) return false;
  if (!compatibility.platforms.includes(host.platform as MarketPlatform)) return false;
  const app = parseAppVersion(host.hostVersion);
  if (!app) return false;
  const min = parseAppVersion(compatibility.minAppVersion);
  if (!min || compareAppVersion(app, min) < 0) return false;
  if (compatibility.maxAppVersion) {
    const max = parseAppVersion(compatibility.maxAppVersion);
    if (!max || compareAppVersion(app, max) > 0) return false;
  }
  return true;
}

function parseScreenshots(raw: unknown): MarketScreenshot[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const shots: MarketScreenshot[] = [];
  for (const item of raw) {
    if (shots.length >= MAX_MARKET_SCREENSHOTS) break;
    if (!isRecord(item) || !str(item.url, 1000)) continue;
    // 同源相对路径交给 Main 解析并限制到市场自有域名；绝对地址只收 https
    const url = item.url;
    const absolute = /^[a-z][a-z0-9+.-]*:/i.test(url);
    if (absolute ? !url.startsWith('https://') : !isPluginRelativePath(url)) continue;
    shots.push({ url, alt: typeof item.alt === 'string' ? item.alt.slice(0, 200) : '' });
  }
  return shots.length > 0 ? shots : undefined;
}

function parseReadme(raw: unknown): MarketPlugin['readme'] {
  if (!isRecord(raw)) return undefined;
  if (!isPluginRelativePath(raw.path) || !/^[A-Za-z0-9._/-]+$/.test(raw.path)) return undefined;
  if (typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.sha256)) return undefined;
  if (!Number.isSafeInteger(raw.size) || (raw.size as number) <= 0) return undefined;
  if ((raw.size as number) > README_MAX_BYTES) return undefined;
  return { path: raw.path, sha256: raw.sha256, size: raw.size as number };
}

interface VersionBase {
  version: string;
  permissions: string[];
  path: string;
  sha256: string;
  size: number;
  publishedAt?: string;
  compatibility: unknown;
}

function parseVersionBase(raw: unknown): VersionBase | null {
  if (!isRecord(raw) || !str(raw.version, 40) || !PLUGIN_VERSION.test(raw.version)) return null;
  const version = raw.version;
  if (!isPluginRelativePath(raw.path) || !/^[A-Za-z0-9._/-]+$/.test(raw.path)) return null;
  if (typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.sha256)) return null;
  if (!Number.isSafeInteger(raw.size) || (raw.size as number) <= 0) return null;
  return {
    version,
    permissions: strings(raw.permissions, 64),
    path: raw.path,
    sha256: raw.sha256,
    size: raw.size as number,
    publishedAt: optStr(raw.publishedAt, 40),
    compatibility: raw.compatibility,
  };
}

function parseVersion(raw: unknown, host: MarketHost): MarketVersion | null {
  const base = parseVersionBase(raw);
  if (!base) return null;
  if (!isMarketCompatible(base.compatibility, host)) return null;
  const compatibility = parseCompatibility(base.compatibility);
  if (!compatibility) return null;
  return { ...base, compatibility };
}

const newestOf = (versions: { version: string }[]): string =>
  versions.reduce((a, b) => (isNewerPluginVersion(b.version, a.version) ? b : a)).version;

function parsePlugin(raw: unknown, host: MarketHost): MarketPlugin | null {
  if (!isRecord(raw) || !isPluginId(raw.id) || !str(raw.name, 60)) return null;
  if (raw.tier !== 'official' && raw.tier !== 'community') return null;
  if (!Array.isArray(raw.versions)) return null;
  const published = raw.versions.map(parseVersionBase).filter((v): v is VersionBase => v !== null);
  if (published.length === 0) return null;
  // 同一个 version 出现两次时无法判断哪份字节才是权威，整条丢弃
  if (new Set(published.map((v) => v.version)).size !== published.length) return null;
  const versions = raw.versions
    .map((v) => parseVersion(v, host))
    .filter((v): v is MarketVersion => v !== null);
  if (versions.length === 0) return null;
  const latest = newestOf(versions);
  const newest = newestOf(published);
  const screenshots = parseScreenshots(raw.screenshots);
  // README 是插件级字段：只有在所选兼容版本就是最新发布版本时才可信，
  // 否则它很可能描述的是当前宿主装不上的新版本。
  const readme = latest === newest ? parseReadme(raw.readme) : undefined;
  return {
    id: raw.id,
    name: raw.name,
    description: typeof raw.description === 'string' ? raw.description.slice(0, 1000) : '',
    tier: raw.tier,
    tags: strings(raw.tags, 32),
    homepage: optStr(raw.homepage, 500),
    icon: optStr(raw.icon, 1000),
    ...(isMarketCategory(raw.category) ? { category: raw.category } : {}),
    ...(screenshots ? { screenshots } : {}),
    ...(readme ? { readme } : {}),
    latest,
    newest,
    versions,
  };
}

/** 结构校验；单个条目不合法只丢弃该条，顶层不合法返回 null */
export function parseMarketIndex(raw: unknown, host: MarketHost): MarketIndex | null {
  if (!isRecord(raw) || raw.schemaVersion !== MARKET_SCHEMA_VERSION) return null;
  if (raw.marketId !== MARKET_ID || !Array.isArray(raw.plugins)) return null;
  if (!Number.isSafeInteger(raw.sequence) || (raw.sequence as number) < 0) return null;
  const seen = new Set<string>();
  const plugins: MarketPlugin[] = [];
  for (const item of raw.plugins) {
    const p = parsePlugin(item, host);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    plugins.push(p);
  }
  return {
    schemaVersion: MARKET_SCHEMA_VERSION,
    marketId: MARKET_ID,
    sequence: raw.sequence as number,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : '',
    plugins,
  };
}

export interface LoadMarketIndexInput extends MarketHost {
  bytes: Uint8Array;
  /** base64 的 Ed25519 签名 */
  signature: string;
  /** SPKI PEM，任一通过即可 */
  publicKeys: string[];
  /** 已见过的最大 sequence，更小的索引视为回滚 */
  minSequence: number;
}

export type LoadMarketIndexResult = { ok: true; index: MarketIndex } | { ok: false; error: string };

function signatureValid(bytes: Uint8Array, signature: string, publicKeys: string[]): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false;
  const sig = Buffer.from(signature, 'base64');
  return publicKeys.some((pem) => {
    try {
      return verify(null, bytes, createPublicKey(pem), sig);
    } catch {
      return false;
    }
  });
}

export function loadMarketIndex(input: LoadMarketIndexInput): LoadMarketIndexResult {
  if (!signatureValid(input.bytes, input.signature.trim(), input.publicKeys))
    return { ok: false, error: '插件索引签名无效' };
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(input.bytes).toString('utf8'));
  } catch {
    return { ok: false, error: '插件索引不是合法 JSON' };
  }
  const index = parseMarketIndex(raw, {
    hostVersion: input.hostVersion,
    platform: input.platform,
  });
  if (!index) return { ok: false, error: '插件索引格式不支持' };
  if (index.sequence < input.minSequence) return { ok: false, error: '插件索引比本地已有的旧' };
  return { ok: true, index };
}
