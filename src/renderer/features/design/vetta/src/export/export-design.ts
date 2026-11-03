import type { PluginContext } from "@vetta-org/plugin-sdk";
import { strToU8, zipSync, type Zippable } from "fflate";
import { assertDesignArchivePath } from "@shared/design/archive";
import { buildDesign } from "../engine/engine-manager";
import { HISTORY_ENTRY, packHistoryForShare } from "../history/history-transfer";
import type { DesignSession } from "../vetd/design-session";
import { MANIFEST_FILE } from "../vetd/manifest-types";
import { SHARE_EXTENSION } from "./share-format";
import { parsePackagedVetd } from "./import-design";

const BUILD_DIR = ".vetd-build";
// `.notes.json` 是用户和 Vetta 之间的工作批注，不是设计内容，分享包不带。
// `design.json` 在包里单独以 manifest.json 落一份，不重复进 design/。
const EXCLUDED_PREFIXES = [`${BUILD_DIR}/`, "node_modules/", ".snapshots/", ".history/", ".history-pack.zip", ".notes.json", MANIFEST_FILE];
const MAX_PACKAGE_BYTES = 32 * 1024 * 1024;
const packageQueues = new Map<string, Promise<unknown>>();

function base64FromBytes(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

function bytesFromBase64(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

const TEXT_EXTENSIONS = new Set(["tsx", "ts", "css", "json", "html", "svg", "md", "txt", "js", "mjs"]);

/**
 * 把 `needle` 换成 `replacement` 的**字面量**版本。
 *
 * `String.replace(string, string)` 会解释替换串里的 `$&`、`$'`、`` $` ``、`$1`：压缩后的
 * react / react-router 里就有 `.replace(Rt,"$&/")` 这类代码，`$&` 会被展开成刚匹配掉的
 * 那段 `<script … src="…"></script>`，于是 script 提前闭合，快照里剩下的 JS 全部变成
 * 页面正文——分享包预览显示成一堆乱码就是这么来的。replacer 函数没有这层解释。
 */
function replaceOnce(source: string, needle: string, replacement: string): string {
	return source.replace(needle, () => replacement);
}

/**
 * Inline the vite build output (single chunk, see engine config) into one
 * self-contained snapshot.html so packaged previews render offline without a
 * server. Relative asset references (design assets/) are a documented v1
 * limitation of packaged previews.
 */
export async function buildSnapshotHtml(ctx: PluginContext, outDir: string): Promise<string> {
	let html = (await ctx.fs.readFile(`${outDir}/index.html`)).content;
	const scriptMatch = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
	if (scriptMatch) {
		const src = scriptMatch[1].replace(/^\//, "");
		const js = (await ctx.fs.readFile(`${outDir}/${src}`)).content.replaceAll("</script>", "<\\/script>");
		html = replaceOnce(html, scriptMatch[0], `<script type="module">${js}</script>`);
	}
	const linkPattern = /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g;
	const links = [...html.matchAll(linkPattern)];
	for (const link of links) {
		const href = link[1].replace(/^\//, "");
		const css = (await ctx.fs.readFile(`${outDir}/${href}`)).content;
		html = replaceOnce(html, link[0], `<style>${css}</style>`);
	}
	return html;
}

export interface DesignPackage {
	/** 建议文件名，作为另存为对话框的默认值。 */
	fileName: string;
	/** zip 字节的 base64 文本。 */
	base64: string;
}

/**
 * Pack the design bundle into a self-contained share file (zip):
 * manifest.json + design sources + snapshot.html. Returns the bytes; the
 * caller decides where they land.
 */
export async function buildDesignPackage(ctx: PluginContext, session: DesignSession): Promise<DesignPackage> {
	const outDir = `${session.dirPath}/${BUILD_DIR}`;
	const previous = packageQueues.get(session.dirPath) ?? Promise.resolve();
	const work = previous.catch(() => {}).then(async () => {
		try { return await buildPackage(ctx, session, outDir); }
		finally { await ctx.fs.delete(outDir).catch(() => {}); }
	});
	packageQueues.set(session.dirPath, work);
	try { return await work; }
	finally { if (packageQueues.get(session.dirPath) === work) packageQueues.delete(session.dirPath); }
}

async function buildPackage(ctx: PluginContext, session: DesignSession, outDir: string): Promise<DesignPackage> {
	await buildDesign(ctx, session.dirPath, outDir);
	const snapshotHtml = await buildSnapshotHtml(ctx, outDir);
	if (new TextEncoder().encode(snapshotHtml).byteLength > MAX_PACKAGE_BYTES)
		throw new Error("Design snapshot exceeds the 32 MiB share limit");

	const zipEntries: Zippable = {
		"manifest.json": strToU8(`${JSON.stringify(session.manifest, null, "\t")}\n`),
		"snapshot.html": strToU8(snapshotHtml),
	};
	const files = await ctx.fs.listFilesRecursive(session.dirPath);
	let total = Object.values(zipEntries).reduce((sum, bytes) => sum + (bytes as Uint8Array).length, 0);
	if (files.length > 10000) throw new Error("Too many files in design share");
	for (const file of files) {
		const rel = file.relPath.replaceAll("\\", "/");
		assertDesignArchivePath(rel);
		if (EXCLUDED_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
		const extension = rel.split(".").pop()?.toLowerCase() ?? "";
		if (TEXT_EXTENSIONS.has(extension)) {
			const text = await ctx.fs.readFile(file.path);
			zipEntries[`design/${rel}`] = strToU8(text.content);
		} else {
			const binary = await ctx.fs.readBinaryFile(file.path);
			zipEntries[`design/${rel}`] = bytesFromBase64(binary.data);
		}
		const bytes = zipEntries[`design/${rel}`] as Uint8Array;
		total += bytes.length;
		if (bytes.length > MAX_PACKAGE_BYTES || total > 128 * 1024 * 1024)
			throw new Error("Design sources exceed the share size limit");
	}
	// 版本历史跟着分享包走（ADR-0069）：收包方导入后能看到这份设计是怎么长成这样的。
	const history = await packHistoryForShare(ctx, session.dirPath);
	if (history.kind === "ok") {
		const bytes = bytesFromBase64(history.base64);
		total += bytes.length;
		if (total > 128 * 1024 * 1024 || bytes.length > MAX_PACKAGE_BYTES)
			throw new Error("Design history exceeds the share size limit");
		zipEntries[HISTORY_ENTRY] = bytes;
	}
	if (history.kind === "too-large") {
		ctx.ui.notify({
			variant: "warning",
			message: `版本历史有 ${Math.round(history.bytes / 1024 / 1024)}MB，超过分享包能携带的上限，本次导出不含历史。设计内容是完整的。`,
		});
	}

	const zipped = zipSync(zipEntries, { level: 6 });
	if (zipped.byteLength > MAX_PACKAGE_BYTES) throw new Error("Design share exceeds the 32 MiB import limit");
	// Validate the exact output with the importer's manifest, count and nested limits.
	parsePackagedVetd(zipped);
	return {
		fileName: `${session.name}-share.${SHARE_EXTENSION}`,
		base64: base64FromBytes(zipped),
	};
}

/**
 * 构建分享包并让用户在系统另存为对话框里挑落点。
 *
 * 不写进项目目录：导出的产物是给人拿去分享的，不属于设计源码，落回工作区只会污染
 * 文件树并被下一次导入/构建误当成内容。用户取消时返回 `null`。
 */
export async function exportDesign(ctx: PluginContext, session: DesignSession): Promise<string | null> {
	const pkg = await buildDesignPackage(ctx, session);
	return await ctx.fs.saveAs(pkg.fileName, pkg.base64, "base64", {
		filters: [{ name: "Vetta Design", extensions: [SHARE_EXTENSION] }],
	});
}
