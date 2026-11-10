import type {
	PluginAgentToolHandler,
	PluginAgentToolRegistration,
	PluginContext,
	PluginFsApi,
} from "@vetta-org/plugin-sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { inspectIssues, composeVerificationSheet } = vi.hoisted(() => ({
	inspectIssues: vi.fn(async () => []),
	composeVerificationSheet: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("../src/vetd/inspect", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/vetd/inspect")>();
	return { ...original, inspectIssues };
});

vi.mock("../src/vetd/render-verification", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/vetd/render-verification")>();
	return { ...original, composeVerificationSheet };
});

import { toDesignToolResult } from "../../host/results";
import { setCanvasController } from "../src/canvas/design-runtime";
import { registerDesignTools } from "../src/tools";

let screenshotHandler: PluginAgentToolHandler<{ frame?: string; frames?: string[]; all?: boolean }>;
const captureFrame = vi.fn(async (frameId: string) => `data:image/jpeg;base64,${frameId.toUpperCase()}`);

beforeEach(() => {
	inspectIssues.mockClear();
	captureFrame.mockClear();
	composeVerificationSheet.mockReset().mockResolvedValue("data:image/jpeg;base64,U0hFRVQ=");
	setCanvasController({
		port: 4321,
		captureFrame,
		session: {
			vetdPath: "C:/work/design.vetd",
			dirPath: "C:/work/design.vetd",
			manifest: {
				version: 1,
				type: "vetta-design",
				canvas: { x: 0, y: 0, zoom: 1 },
				frames: [
					{
						id: "login",
						file: "frames/login.tsx",
						x: 0,
						y: 0,
						width: 390,
						height: 844,
						title: "Login",
						meta: { width: 390, height: 844, title: "Login" },
					},
					{
						id: "detail",
						file: "frames/detail.tsx",
						x: 430,
						y: 0,
						width: 390,
						height: 844,
						title: "Detail",
						meta: { width: 390, height: 844, title: "Detail" },
					},
				],
			},
		} as never,
		notes: { notes: [] } as never,
		resolveNoteElements: vi.fn(),
		openDesign: vi.fn(),
	});
	const ctx = {
		agent: {
			registerTool: (registration: PluginAgentToolRegistration) => {
				if (registration.name === "vetd_screenshot") {
					screenshotHandler = registration.handler as typeof screenshotHandler;
				}
				return { dispose: () => {} };
			},
		},
		ui: { openActivityTab: vi.fn() },
	} as unknown as PluginContext;
	registerDesignTools(ctx);
});

afterEach(() => setCanvasController(null));

function makeFs() {
	const files = new Map([
		["C:/work/design.vetd/frames/login.tsx", "export default function Login() { return <div /> }"] ,
		["C:/work/design.vetd/frames/detail.tsx", "export default function Detail() { return <div /> }"] ,
		["C:/work/design.vetd/theme.css", "@theme {}"],
		["C:/work/design.vetd/package.json", "{}"],
	]);
	const writes: string[] = [];
	const fs = {
		readDir: async (dirPath: string) => {
			if (dirPath.endsWith("/.snapshots")) return [];
			return [...files.keys()]
				.filter((path) => path.startsWith(`${dirPath}/`) && !path.slice(dirPath.length + 1).includes("/"))
				.map((path) => ({
					name: path.slice(dirPath.length + 1),
					path,
					isDirectory: false,
					size: 1,
					modifiedAt: 1,
				}));
		},
		readFile: async (path: string) => {
			const content = files.get(path);
			if (content === undefined) throw new Error(`missing: ${path}`);
			return { content, encoding: "utf8" as const };
		},
		writeFile: async (path: string) => {
			writes.push(path);
		},
		stat: async () => null,
	} as unknown as PluginFsApi;

	return { fs, writes };
}

async function runScreenshot(input: { frame?: string; frames?: string[]; all?: boolean }) {
	const { fs, writes } = makeFs();
	const result = (await screenshotHandler({
		host: { fs },
		session: { cwd: "C:/work" },
		trigger: { input },
	} as never)) as {
		ok: boolean;
		path?: string;
		frames: { frame: string; path: string }[];
		cards: { payload: { frameId?: string; overviewCapturedAt?: number } }[];
	};
	return { result, writes };
}

it.each([
	{ mode: "all", input: { all: true } },
	{ mode: "frames", input: { frames: ["login", "detail"] } },
])("批量校验逐帧落盘，只展示本次总览（$mode）", async ({ input }) => {
	const { result, writes } = await runScreenshot(input);
	expect(result.ok).toBe(true);
	expect(result.frames.map((frame) => frame.frame)).toEqual(["login", "detail"]);
	expect(inspectIssues).toHaveBeenCalledTimes(1);
	expect(captureFrame).toHaveBeenCalledTimes(2);
	expect(writes.filter((path) => path.includes("/.snapshots/"))).toEqual([
		...result.frames.map(({ path }) => path),
		result.path,
	]);
	expect(result.cards).toHaveLength(1);
	expect(result.path).toMatch(/\/\.snapshots\/verification-overview-\d+\.png$/);
	expect(result.path).toContain(`-${result.cards[0].payload.overviewCapturedAt}.png`);
	expect(toDesignToolResult(result).content.map(({ type }) => type)).toEqual(["text"]);
});

it("无法合成总览时保留逐帧预览和路径", async () => {
	composeVerificationSheet.mockResolvedValue(null);
	const { result } = await runScreenshot({ all: true });
	expect(result.path).toBeUndefined();
	expect(result.cards.map(({ payload }) => payload.frameId)).toEqual(["login", "detail"]);
});

it("批次仅有一张成功截图时直接使用原图预览", async () => {
	const { result } = await runScreenshot({ frames: ["login", "unknown"] });
	expect(result.path).toBe(result.frames[0].path);
	expect(result.cards.map(({ payload }) => payload.frameId)).toEqual(["login"]);
});
