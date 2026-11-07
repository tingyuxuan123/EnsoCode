/**
 * Windows 上引擎物化在 C:（userData），设计稿常在 D:/E: 的项目里。vite 的
 * import.meta.glob 把跨盘的命中写成 `../../…/E:/x.tsx`，import 分析解析不了，
 * 引擎入口编译失败，画布上所有 frame 白屏、截图超时。
 */
import { expect, it } from "vitest";
import { absolutizeCrossDriveImports, contentTypeOf, crossDriveFsPath } from "@design-engine/src/cross-drive";
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
	expect(ENGINE_FILES["vite.config.mjs"]).toContain("crossDriveFsPath(");
});

/**
 * vite 在 Windows 上提供 `/@fs/E:/…` 的原始文件（图片、字体）时去掉盘符、从进程所在盘
 * 的根找：引擎在 C:，就去找 C:\…，找不到落到 index.html，图片破图、字体退回系统字体。
 */
it("跨盘的 /@fs/ 原始文件请求解析成盘符绝对路径", () => {
	expect(crossDriveFsPath("/@fs/E:/project/a.vetd/assets/x.png", "C")).toBe("E:/project/a.vetd/assets/x.png");
	expect(crossDriveFsPath("/@fs/e:/p/font.woff2?v=3#x", "C")).toBe("e:/p/font.woff2");
	expect(crossDriveFsPath("/@fs/E:/p/%E5%9B%BE%20a.png", "C")).toBe("E:/p/图 a.png");
});

it("同盘、非 /@fs/、带 ?import 等模块请求都交回 vite", () => {
	expect(crossDriveFsPath("/@fs/C:/engine/x.png", "C")).toBeNull();
	expect(crossDriveFsPath("/@fs/c:/engine/x.png", "C")).toBeNull();
	expect(crossDriveFsPath("/src/main.tsx", "C")).toBeNull();
	expect(crossDriveFsPath("/@fs/E:/p/x.png?import", "C")).toBeNull();
	expect(crossDriveFsPath("/@fs/E:/p/x.tsx", "C")).toBeNull();
	expect(crossDriveFsPath("/@fs/E:/p/x.png", null)).toBeNull();
});

it("按扩展名给出内容类型", () => {
	expect(contentTypeOf("E:/a/B.PNG")).toBe("image/png");
	expect(contentTypeOf("E:/a/f.woff2")).toBe("font/woff2");
	expect(contentTypeOf("E:/a/f.unknown")).toBe("application/octet-stream");
});
