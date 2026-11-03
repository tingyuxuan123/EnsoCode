import type { PluginContext } from "@vetta-org/plugin-sdk";
import { assertDesignArchivePath, decodeDesignArchive } from "@shared/design/archive";
import { strFromU8 } from "fflate";
import { HISTORY_ENTRY, unpackHistoryFromShare } from "../history/history-transfer";
import { emptyManifest, manifestPathOf, type VetdManifest } from "../vetd/manifest-types";
import { sanitizeDesignName } from "../vetd/scaffold";
import { repairPackagedSnapshot } from "./snapshot-repair";

export interface PackagedVetd {
	manifestJson: string;
	snapshotHtml: string | null;
	/** design-relative path → bytes */
	designFiles: Map<string, Uint8Array>;
	/** 打包好的版本历史。0.6.0 之前导出的包没有这一项。 */
	historyZip: Uint8Array | null;
}

const MAX_FILE = 32 * 1024 * 1024;
const MAX_TOTAL = 128 * 1024 * 1024;
const MAX_MANIFEST = 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const boundedText = (value: unknown, max = 1024): value is string => typeof value === "string" && value.length <= max && !value.includes("\0");
function invalid(): never { throw new Error("Invalid design manifest or package"); }
function size(value: unknown): value is Record<string, unknown> & { width: number; height: number } {
	return record(value) && finite(value.width, 1, 16384) && finite(value.height, 1, 16384) && value.width * value.height <= 64 * 1024 * 1024;
}

/** Strict untrusted-file reader; old manifests may omit canvas/meta, not dimensions or paths. */
export function parseDesignManifest(json: string): VetdManifest {
	if (json.length > MAX_MANIFEST) invalid();
	const value: unknown = JSON.parse(json);
	if (!record(value) || value.version !== 1 || value.type !== "vetta-design" || !Array.isArray(value.frames) || value.frames.length > 512) invalid();
	const result = emptyManifest();
	if (value.canvas !== undefined) {
		if (!record(value.canvas) || !finite(value.canvas.x, -1e7, 1e7) || !finite(value.canvas.y, -1e7, 1e7) || !finite(value.canvas.zoom, 0.01, 64)) invalid();
		result.canvas = { x: value.canvas.x, y: value.canvas.y, zoom: value.canvas.zoom };
	}
	const ids = new Set<string>();
	const files = new Set<string>();
	result.frames = value.frames.map((frame: unknown) => {
		if (!record(frame) || !boundedText(frame.id, 256) || !frame.id || !boundedText(frame.file, 4096) || !size(frame) || !finite(frame.x, -1e7, 1e7) || !finite(frame.y, -1e7, 1e7) || !boundedText(frame.title)) invalid();
		assertDesignArchivePath(frame.id);
		assertDesignArchivePath(frame.file);
		if (!frame.file.startsWith("frames/") || !frame.file.endsWith(".tsx") || ids.has(frame.id) || files.has(frame.file)) invalid();
		ids.add(frame.id); files.add(frame.file);
		const meta = frame.meta ?? { width: frame.width, height: frame.height, title: frame.title };
		if (!record(meta) || !size(meta) || !boundedText(meta.title) || (meta.radius !== undefined && !finite(meta.radius, 0, 16384)) || (frame.radius !== undefined && !finite(frame.radius, 0, 16384)) || (frame.expanded !== undefined && frame.expanded !== true)) invalid();
		return { id: frame.id, file: frame.file, x: frame.x, y: frame.y, width: frame.width, height: frame.height, title: frame.title,
			meta: { width: meta.width, height: meta.height, title: meta.title, ...(meta.radius !== undefined ? { radius: meta.radius } : {}) },
			...(frame.radius !== undefined ? { radius: frame.radius } : {}), ...(frame.expanded === true ? { expanded: true as const } : {}) };
	});
	if (value.defaultFrameSize !== undefined) { if (!size(value.defaultFrameSize)) invalid(); result.defaultFrameSize = { width: value.defaultFrameSize.width, height: value.defaultFrameSize.height }; }
	if (value.statusBar !== undefined) { if (value.statusBar !== "island" && value.statusBar !== "notch" && value.statusBar !== "flat" && value.statusBar !== "none") invalid(); result.statusBar = value.statusBar; }
	if (value.interactionMode !== undefined) { if (value.interactionMode !== "mobile" && value.interactionMode !== "desktop" && value.interactionMode !== "other") invalid(); result.interactionMode = value.interactionMode; }
	return result;
}

function validatePackage(packaged: PackagedVetd, decodedOuterBytes = 0): void {
	parseDesignManifest(packaged.manifestJson);
	let total = new TextEncoder().encode(packaged.manifestJson).length;
	const paths = new Map<string, string>();
	if (packaged.designFiles.size > 9997) invalid();
	for (const [rel, bytes] of packaged.designFiles) {
		assertDesignArchivePath(rel);
		const normalized = rel.normalize("NFC").toLowerCase();
		if (paths.has(normalized) || /^(?:design\.json|\.history(?:\/|$)|\.history-pack\.zip|\.git(?:\/|$))/.test(normalized) || bytes.length > MAX_FILE) invalid();
		paths.set(normalized, rel);
		total += bytes.length;
	}
	for (const rel of paths.keys()) {
		const segments = rel.split("/");
		for (let i = 1; i < segments.length; i++) if (paths.has(segments.slice(0, i).join("/"))) invalid();
	}
	if (packaged.snapshotHtml) {
		const length = new TextEncoder().encode(packaged.snapshotHtml).length;
		if (length > MAX_FILE) invalid();
		total += length;
	}
	// Unknown extension entries are ignored, but still occupy memory while nested history decodes.
	total = Math.max(total, decodedOuterBytes - (packaged.historyZip?.length ?? 0));
	if (packaged.historyZip) {
		total += packaged.historyZip.length;
		if (total > MAX_TOTAL) invalid();
		const history = decodeDesignArchive(packaged.historyZip, { maxCompressedBytes: 24 * 1024 * 1024, maxUncompressedBytes: Math.min(64 * 1024 * 1024, MAX_TOTAL - total) });
		for (const bytes of history.values()) total += bytes.length;
	}
	if (total > MAX_TOTAL) invalid();
}

export function parsePackagedVetd(bytes: Uint8Array): PackagedVetd {
	const entries = decodeDesignArchive(bytes);
	const manifest = entries.get("manifest.json");
	if (!manifest) throw new Error("share file missing manifest.json");
	if (manifest.length > MAX_MANIFEST) invalid();
	const designFiles = new Map<string, Uint8Array>();
	for (const [name, content] of entries) {
		if (name.startsWith("design/") && !name.endsWith("/")) {
			designFiles.set(name.slice("design/".length), content);
		}
	}
	const packaged: PackagedVetd = {
		manifestJson: JSON.stringify(parseDesignManifest(strFromU8(manifest))),
		// 0.3.1 之前导出的快照可能被 `$&` 展开写坏，读回来时先还原（见 snapshot-repair）。
		snapshotHtml: entries.has("snapshot.html") ? repairPackagedSnapshot(strFromU8(entries.get("snapshot.html")!)) : null,
		designFiles,
		historyZip: entries.get(HISTORY_ENTRY) ?? null,
	};
	validatePackage(packaged, [...entries.values()].reduce((sum, content) => sum + content.length, 0));
	return packaged;
}

function base64FromBytes(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/**
 * Unpack a share file into a working design bundle (`x.vetd/`) inside
 * `targetDir`. Returns the new bundle path.
 */
export async function importPackagedVetd(
	ctx: PluginContext,
	packaged: PackagedVetd,
	targetDir: string,
	sourceFileName: string,
): Promise<string> {
	// Revalidate and snapshot before the first await: callers can hold/mutate the public Map.
	validatePackage(packaged);
	const files = [...packaged.designFiles].map(([rel, bytes]) => [rel, bytes.slice()] as const);
	const manifestJson = packaged.manifestJson;
	const historyZip = packaged.historyZip?.slice();
	if (!targetDir.startsWith("/") || targetDir.includes("\\") || targetDir.includes("\0") || targetDir.split("/").some((part) => part === "." || part === "..")) invalid();
	targetDir = targetDir.replace(/\/+$/, "");
	const baseName = sanitizeDesignName(sourceFileName.replace(/\.(?:vetdz|vetd)$/i, "").replace(/-share$/i, ""));
	let vetdPath = `${targetDir}/${baseName}.vetd`;
	let suffix = 1;
	while ((await ctx.fs.stat(vetdPath)) !== null) {
		vetdPath = `${targetDir}/${baseName}-${suffix}.vetd`;
		suffix += 1;
	}
	for (const [rel, bytes] of files) {
		await ctx.fs.writeFile(`${vetdPath}/${rel}`, base64FromBytes(bytes), "base64");
	}
	await ctx.fs.writeFile(manifestPathOf(vetdPath), manifestJson);
	// 历史在源码之后还原：`.history/` 里存的就是这些文件的旧版本，先落地内容再接上历史，
	// 之后第一次打开这份设计时不会因为「工作区与 HEAD 不一致」而多出一个空版本。
	if (historyZip) {
		await unpackHistoryFromShare(ctx, vetdPath, base64FromBytes(historyZip));
	}
	return vetdPath;
}
