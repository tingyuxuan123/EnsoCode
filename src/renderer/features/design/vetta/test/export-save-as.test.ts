/**
 * 导出分享包的落点。
 *
 * 分享包是给人拿走的产物，不是设计源码：它必须走宿主的系统另存为对话框，绝不能
 * 被写回项目目录（会污染文件树，并被下一次构建/导入当成内容）。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { beforeEach, expect, it, vi } from "vitest";

const buildDesign = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../src/engine/engine-manager", () => ({ buildDesign }));

const { exportDesign } = await import("../src/export/export-design");
const { SHARE_EXTENSION } = await import("../src/export/share-format");

interface SaveAsCall {
	fileName: string;
	content: string;
	encoding?: string;
}

function fakeSession() {
	return {
		dirPath: "/proj/checkout.vetd",
		vetdPath: "/proj/checkout.vetd",
		name: "checkout",
		manifest: { version: 1, type: "vetta-design", frames: [], canvas: { x: 0, y: 0, zoom: 1 } },
	} as never;
}

function fakeCtx(saveAs: (call: SaveAsCall) => string | null) {
	const writes: string[] = [];
	const calls: SaveAsCall[] = [];
	const deleted: string[] = [];
	const ctx = {
		fs: {
			readFile: async (path: string) => {
				if (path.endsWith("/index.html")) return { content: "<html></html>" };
				return { content: "x" };
			},
			readBinaryFile: async () => ({ data: "", mimeType: "application/octet-stream", size: 0 }),
			listFilesRecursive: async () => [{ name: "app.tsx", path: "/proj/checkout.vetd/app.tsx", relPath: "app.tsx" }],
			writeFile: async (path: string) => {
				writes.push(path);
			},
			delete: async (path: string) => { deleted.push(path); },
			saveAs: async (fileName: string, content: string, encoding?: string) => {
				const call = { fileName, content, encoding };
				calls.push(call);
				return saveAs(call);
			},
		},
	} as unknown as PluginContext;
	return { ctx, writes, calls, deleted };
}

beforeEach(() => {
	buildDesign.mockClear();
	buildDesign.mockReset();
});

it("把分享包交给系统另存为对话框，不写进项目目录", async () => {
	const { ctx, writes, calls } = fakeCtx(() => "/Users/me/Desktop/checkout-share.vetdz");

	const path = await exportDesign(ctx, fakeSession());

	expect(path).toBe("/Users/me/Desktop/checkout-share.vetdz");
	expect(calls).toHaveLength(1);
	expect(calls[0].fileName).toBe(`checkout-share.${SHARE_EXTENSION}`);
	expect(calls[0].encoding).toBe("base64");
	expect(calls[0].content.length).toBeGreaterThan(0);
	expect(writes).toEqual([]);
});

it("用户取消时返回 null，磁盘上什么都不留", async () => {
	const { ctx, writes } = fakeCtx(() => null);

	expect(await exportDesign(ctx, fakeSession())).toBeNull();
	expect(writes).toEqual([]);
});

it("cleans intermediate build output after a failed build without opening save-as", async () => {
	const { ctx, calls, deleted } = fakeCtx(() => null);
	buildDesign.mockRejectedValueOnce(new Error("build failed"));
	await expect(exportDesign(ctx, fakeSession())).rejects.toThrow("build failed");
	expect(calls).toEqual([]);
	expect(deleted).toContain("/proj/checkout.vetd/.vetd-build");
});

it("refuses oversized content before producing a package that the importer cannot accept", async () => {
	const { ctx, calls, deleted } = fakeCtx(() => null);
	ctx.fs.readFile = async () => ({ content: "x".repeat(32 * 1024 * 1024 + 1), encoding: "utf8" });
	await expect(exportDesign(ctx, fakeSession())).rejects.toThrow();
	expect(calls).toEqual([]);
	expect(deleted).toContain("/proj/checkout.vetd/.vetd-build");
});

it("serializes exports for the same design so one cleanup cannot remove another build", async () => {
	const { ctx } = fakeCtx(() => null);
	let finish: (() => void) | undefined;
	buildDesign.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
	const first = exportDesign(ctx, fakeSession());
	const second = exportDesign(ctx, fakeSession());
	await vi.waitFor(() => expect(finish).toBeDefined());
	expect(buildDesign).toHaveBeenCalledTimes(1);
	finish!();
	await Promise.all([first, second]);
	expect(buildDesign).toHaveBeenCalledTimes(2);
});

it("never saves a share whose source entry count is rejected by the importer", async () => {
	const { ctx, calls } = fakeCtx(() => null);
	ctx.fs.listFilesRecursive = async () => Array.from({ length: 9998 }, (_, i) => ({
		name: `${i}.tsx`, path: `/proj/checkout.vetd/frames/${i}.tsx`, relPath: `frames/${i}.tsx`,
	}));
	await expect(exportDesign(ctx, fakeSession())).rejects.toThrow();
	expect(calls).toEqual([]);
});
