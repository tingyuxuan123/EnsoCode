/**
 * Windows 上引擎物化在 C:（userData），设计稿常在 D:/E: 的项目里。vite 的
 * import.meta.glob 把跨盘的命中写成 `../../…/E:/x.tsx`，import 分析解析不了，
 * 引擎入口编译失败，画布上所有 frame 白屏、截图超时。
 */
import { expect, it } from "vitest";
import { absolutizeCrossDriveImports } from "@design-engine/src/cross-drive";
import { ENGINE_FILES } from "../src/engine/engine-files";

const globbed = [
	"const loaders = {",
	'"../../../../../../../../../../E:/project/a.vetd/frames/index.tsx": () => import("../../../../../../../../../../E:/project/a.vetd/frames/index.tsx"),',
	"};",
].join("\n");

it("跨盘的 glob 命中改写成盘符绝对路径", () => {
	const out = absolutizeCrossDriveImports(globbed);
	expect(out).toContain('import("E:/project/a.vetd/frames/index.tsx")');
	expect(out).toContain('"E:/project/a.vetd/frames/index.tsx":');
	expect(out).not.toContain("../E:/");
});

it("同盘的相对路径与普通代码原样保留", () => {
	const same = 'import("../../design/frames/index.tsx"); const s = "../x"; import "./styles.css";';
	expect(absolutizeCrossDriveImports(same)).toBe(same);
	expect(absolutizeCrossDriveImports("const a = 1;")).toBe("const a = 1;");
});

it("引擎配置启用了改写，且改写模块在物化清单里", () => {
	expect(ENGINE_FILES["src/cross-drive.ts"]).toContain("export function absolutizeCrossDriveImports");
	expect(ENGINE_FILES["vite.config.mjs"]).toContain('from "./src/cross-drive.ts"');
	expect(ENGINE_FILES["vite.config.mjs"]).toContain("absolutizeCrossDriveImports(code)");
});
