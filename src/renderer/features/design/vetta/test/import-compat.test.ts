/**
 * 老 `.vetdz` 的向后兼容：0.6.0 之前导出的分享包里没有 history.zip，导入必须照常，
 * 且不能因为「没有历史」多走一步还原。
 */
import { strToU8, zipSync } from "fflate";
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { importPackagedVetd, parsePackagedVetd } from "../src/export/import-design";

function legacyPackage(): Uint8Array {
	return zipSync({
		"manifest.json": strToU8('{"version":1,"type":"vetta-design","frames":[]}'),
		"snapshot.html": strToU8("<html></html>"),
		"design/frames/index.tsx": strToU8("export default function Index(){return null}\n"),
	});
}

describe("老分享包", () => {
	it("没有 history.zip 时解析成 historyZip: null，其余照常", () => {
		const packaged = parsePackagedVetd(legacyPackage());
		expect(packaged.historyZip).toBeNull();
		expect(packaged.designFiles.get("frames/index.tsx")).toBeDefined();
		expect(packaged.snapshotHtml).toContain("<html>");
	});

	it("带 history.zip 的新包解析得出历史", () => {
		const withHistory = zipSync({
			"manifest.json": strToU8('{"version":1,"type":"vetta-design","frames":[]}'),
			"history.zip": zipSync({ HEAD: strToU8("ref: refs/heads/main\n") }),
		});
		expect(parsePackagedVetd(withHistory).historyZip).not.toBeNull();
	});
});

describe("分享包导入的预验证", () => {
	it.each(["C:/项目", "C:/", "/"])("规范绝对目标 %s 使用单个分隔符写入", async (target) => {
		const writeFile = vi.fn(async () => {});
		const ctx = { fs: { stat: async () => null, writeFile } } as unknown as PluginContext;
		const expected = `${target.replace(/\/$/, "")}/app.vetd`;
		expect(await importPackagedVetd(ctx, parsePackagedVetd(legacyPackage()), target, "app.vetdz")).toBe(expected);
		expect(writeFile).toHaveBeenCalledWith(`${expected}/frames/index.tsx`, expect.any(String), "base64");
		expect(writeFile).toHaveBeenCalledWith(`${expected}/design.json`, expect.any(String));
	});
	it.each(["c:/项目", "C:项目", "C:\\项目", "//server/share", "/C:/项目", "C:/项目/../a", "C:/项目/./a", "C:/a\0"])("不规范目标 %s 不读取或写入", async (target) => {
		const stat = vi.fn(async () => null);
		const writeFile = vi.fn();
		const ctx = { fs: { stat, writeFile } } as unknown as PluginContext;
		await expect(importPackagedVetd(ctx, parsePackagedVetd(legacyPackage()), target, "app.vetdz")).rejects.toThrow();
		expect(stat).not.toHaveBeenCalled();
		expect(writeFile).not.toHaveBeenCalled();
	});
	it.each([null, {}, { version: 2, type: "vetta-design", frames: [] }, { version: 1, type: "vetta-design", frames: [null] }, {
		version: 1, type: "vetta-design", canvas: { x: 0, y: 0, zoom: 1e8 }, frames: [],
	}, {
		version: 1, type: "vetta-design", frames: [{ id: "a", file: "../bad.tsx", x: 0, y: 0, width: 100, height: 100, title: "a" }],
	}, {
		version: 1, type: "vetta-design", frames: [{ id: "a", file: "frames/a.tsx", x: 0, y: 0, width: 1e12, height: 900, title: "a" }],
	}])("非法清单在创建项目之前解析失败 %j", (manifest) => {
		expect(() => parsePackagedVetd(zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)) }))).toThrow();
	});
	it("嵌套历史损坏或包含路径逃逸也在解析时拒绝", () => {
		for (const history of [strToU8("PK-fake"), zipSync({ "../escape": strToU8("bad") })]) {
			expect(() => parsePackagedVetd(zipSync({ "manifest.json": strToU8('{"version":1,"type":"vetta-design","frames":[]}'), "history.zip": history }))).toThrow();
		}
	});
	it("被调用者篡改的包不能先写好文件再在坏路径上失败", async () => {
		const packaged = parsePackagedVetd(legacyPackage());
		packaged.designFiles.set("../../neighbor.vetd/design.json", strToU8("bad"));
		const writeFile = vi.fn();
		const stat = vi.fn(async () => null);
		const ctx = { fs: { writeFile, stat } } as unknown as PluginContext;
		await expect(importPackagedVetd(ctx, packaged, "/project", "share.vetdz")).rejects.toThrow();
		expect(writeFile).not.toHaveBeenCalled();
		expect(stat).not.toHaveBeenCalled();
	});
	it("只写新命名的包，不覆盖同名设计", async () => {
		const packaged = parsePackagedVetd(legacyPackage());
		const files = new Map<string, string>([["/project/app.vetd", "existing"]]);
		const ctx = { fs: {
			stat: async (path: string) => files.has(path) ? { size: 1 } : null,
			writeFile: async (path: string, content: string) => { files.set(path, content); },
		} } as unknown as PluginContext;
		expect(await importPackagedVetd(ctx, packaged, "/project", "app-share.vetd")).toBe("/project/app-1.vetd");
		expect(files.get("/project/app.vetd")).toBe("existing");
		expect([...files.keys()].filter((path) => path !== "/project/app.vetd").every((path) => path.startsWith("/project/app-1.vetd/"))).toBe(true);
	});
});
