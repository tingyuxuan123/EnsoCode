import { DESIGN_CATALOG_SOURCES, repoRootUrl } from "../design-systems/catalog-sync";
import type { DesignSystem } from "../design-systems/types";
import { getPluginCtx } from "../plugin-context";

const COVER_ROOTS = DESIGN_CATALOG_SOURCES.map(repoRootUrl);
const MAX_COVER_BYTES = 256 * 1024;
const MAX_STORED_BASE64 = Math.ceil(64 * 1024 / 3) * 4;
const MAX_CONCURRENT = 6;
const CACHE_SLOTS = 64;

export interface StyleCoverRef {
	url: string;
	key: string;
}

export function styleCoverRef(system: DesignSystem): StyleCoverRef | null {
	const cover = system.resources.find((resource) => resource.role === "cover" && resource.encoding === "binary");
	if (cover?.encoding !== "binary" || !/\.webp$/i.test(cover.path) || cover.bytes > MAX_COVER_BYTES) return null;
	try {
		const url = new URL(cover.url);
		if (url.hash || url.href.length > 2048 || !COVER_ROOTS.some((root) => url.href.startsWith(root))) return null;
		return { url: url.href, key: JSON.stringify([url.href, system.version ?? "", cover.bytes]) };
	} catch {
		return null;
	}
}

const loaded = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
const waiting: Array<() => void> = [];
let active = 0;

export function cachedStyleCover({ key }: StyleCoverRef): string | null {
	return loaded.get(key) ?? null;
}

// Main rewrites the whole plugin storage snapshot. A fixed number of small slots caps its size;
// collisions are only cache misses, because the full URL, version and size are stored and compared.
function storagePath(url: string): string {
	let hash = 2166136261;
	for (let i = 0; i < url.length; i++) hash = Math.imul(hash ^ url.charCodeAt(i), 16777619);
	return `design-covers/${(hash >>> 0) % CACHE_SLOTS}.json`;
}

function isWebp(value: unknown): value is string {
	if (typeof value !== "string" || value.length > Math.ceil(MAX_COVER_BYTES / 3) * 4) return false;
	try {
		const bytes = atob(value);
		if (bytes.length < 16 || bytes.length > MAX_COVER_BYTES) return false;
		return bytes.startsWith("RIFF") && /^WEBPVP8[ LX]$/.test(bytes.slice(8, 16));
	} catch {
		return false;
	}
}

async function readStored(ref: StyleCoverRef): Promise<string | null> {
	try {
		const data = await getPluginCtx().storage.readFile(storagePath(ref.url), "utf8");
		if (!data || data.length > MAX_STORED_BASE64 + 4096) return null;
		const cached: unknown = JSON.parse(data);
		return Array.isArray(cached) && cached[0] === ref.key && isWebp(cached[1]) ? cached[1] : null;
	} catch {
		return null;
	}
}

async function fetchCover(ref: StyleCoverRef): Promise<string | null> {
	try {
		const ctx = getPluginCtx();
		const response = await ctx.network.request<unknown>({
			url: ref.url,
			method: "GET",
			responseType: "base64",
			timeoutMs: 15_000,
		});
		if (!response.ok || !isWebp(response.body)) return null;
		if (response.body.length <= MAX_STORED_BASE64) {
			// Cache writes are opportunistic and never delay the visible image.
			void ctx.storage.writeFile(storagePath(ref.url), JSON.stringify([ref.key, response.body]), "utf8").catch(() => {});
		}
		return response.body;
	} catch {
		return null;
	}
}

export function loadStyleCover(ref: StyleCoverRef): Promise<string | null> {
	const hit = cachedStyleCover(ref);
	if (hit) return Promise.resolve(hit);
	const pending = inflight.get(ref.key);
	if (pending) return pending;

	const request = (async () => {
		if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
		else active += 1;
		try {
			const body = (await readStored(ref)) ?? (await fetchCover(ref));
			if (!body) return null;
			const src = `data:image/webp;base64,${body}`;
			loaded.set(ref.key, src);
			if (loaded.size > CACHE_SLOTS) {
				const oldest = loaded.keys().next().value;
				if (oldest !== undefined) loaded.delete(oldest);
			}
			return src;
		} finally {
			const next = waiting.shift();
			if (next) next();
			else active -= 1;
		}
	})().finally(() => inflight.delete(ref.key));
	inflight.set(ref.key, request);
	return request;
}
