import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

const readDir = vi.fn();
const { toVettaFileUrl } = vi.hoisted(() => ({
	toVettaFileUrl: vi.fn(async (_path: string) => ({ url: 'data:image/png;base64,AA==', dispose() {} })),
}));
vi.mock("../src/plugin-context", () => ({
	getPluginCtx: () => ({ fs: { readDir }, ui: { previewImage: vi.fn() } }),
}));
// URL provisioning belongs to the EnsoCode P2 card mount, not swiper layout.
vi.mock('../src/cards/file-url', () => ({ toVettaFileUrl }));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ScreenshotCard } from "../src/cards/ScreenshotCard";
import { SCREENSHOT_CARD_TYPE } from "../src/cards/screenshot-card";
import type { PluginCardProps } from '@vetta-org/plugin-sdk';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let frameSeq = 0;

beforeEach(() => {
	readDir.mockReset();
	toVettaFileUrl.mockClear();
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
});

/** 每个用例用独立 frameId，避开模块级 snapshotCache 的跨用例污染。 */
function makeProps(pending: boolean): PluginCardProps {
	return {
		descriptor: {
			type: SCREENSHOT_CARD_TYPE,
			key: `d.vetd#frame${frameSeq}`,
			payload: { dirPath: "/w/d.vetd", frameId: `frame${frameSeq}` },
		},
		pending,
  message: { id: 'm', role: 'assistant', text: '' },
 };
}

function entry(name: string) {
	return { name, path: `/w/d.vetd/.snapshots/${name}`, isDirectory: false };
}

/** 让所有已排队的 promise 回调跑完。 */
async function flush(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

describe("ScreenshotCard 高度稳定性", () => {
	it("重扫在途时不塌陷：pending 落定到扫描返回之间，卡片区必须保持占位", async () => {
		frameSeq++;
		// 第一次扫描：截图还没落盘，目录不存在
		readDir.mockRejectedValueOnce(new Error("ENOENT"));
		await act(async () => {
			root.render(<ScreenshotCard {...makeProps(true)} />);
		});
		await flush();
		expect(host.innerHTML, "pending 期间应有骨架占位").not.toBe("");

		// 工具落定：pending 转 false，重扫这一刻还没返回
		readDir.mockImplementationOnce(() => new Promise(() => {}));
		await act(async () => {
			root.render(<ScreenshotCard {...makeProps(false)} />);
		});

		expect(
			host.innerHTML,
			"重扫在途时卡片区塌成 0，会把整条消息列表顶得上下弹跳",
		).not.toBe("");
	});

	it("扫描确实为空且不在途时才隐藏卡片", async () => {
		frameSeq++;
		readDir.mockResolvedValueOnce([]);
		await act(async () => {
			root.render(<ScreenshotCard {...makeProps(false)} />);
		});
		await flush();
		expect(host.innerHTML).toBe("");
	});

	it("已有截图后，一次落空的重扫不得清掉已展示的内容", async () => {
		frameSeq++;
		readDir.mockResolvedValueOnce([entry(`frame${frameSeq}-1.png`)]);
		await act(async () => {
			root.render(<ScreenshotCard {...makeProps(false)} />);
		});
		await flush();
		expect(host.querySelectorAll("img")).toHaveLength(1);

		// 新一轮开始，重扫因为瞬时读失败返回空
		readDir.mockResolvedValueOnce([]);
		await act(async () => {
			root.render(<ScreenshotCard {...makeProps(true)} />);
		});
		await flush();
		expect(host.querySelectorAll("img"), "落空的重扫不该抹掉已有版本").toHaveLength(1);
	});
});

it("默认只读取最新版本，主动展开才读取旧截图", async () => {
	frameSeq++;
	const old = entry(`frame${frameSeq}-1.png`);
	const latest = entry(`frame${frameSeq}-2.png`);
	readDir.mockResolvedValue([old, latest]);
	await act(async () => root.render(<ScreenshotCard {...makeProps(false)} />));
	await flush();
	expect(toVettaFileUrl.mock.calls.map(([path]) => path)).toEqual([latest.path]);
	expect(host.querySelectorAll("img")).toHaveLength(1);

	const history = host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
	expect(history).not.toBeNull();
	await act(async () => history?.click());
	await flush();
	expect(toVettaFileUrl.mock.calls.map(([path]) => path)).toContain(old.path);
	expect(host.querySelectorAll("img")).toHaveLength(2);

	await act(async () => history?.click());
	await flush();
	expect(host.querySelectorAll("img")).toHaveLength(1);
});

it("总览卡直接加载对应批次的截图，不扫描历史或加载原图", async () => {
	const props = makeProps(false);
	props.descriptor.payload = { dirPath: "/w/d.vetd", overviewCapturedAt: 42 };
	await act(async () => root.render(<ScreenshotCard {...props} />));
	await flush();
	expect(readDir).not.toHaveBeenCalled();
	expect(toVettaFileUrl.mock.calls.map(([path]) => path)).toEqual([
		"/w/d.vetd/.snapshots/verification-overview-42.png",
	]);
	expect(host.querySelectorAll("img")).toHaveLength(1);
});

it("总览已被轮换清理时不会无限显示截图中", async () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		toVettaFileUrl.mockRejectedValueOnce(new Error("ENOENT"));
		const props = makeProps(false);
		props.descriptor.payload = { dirPath: "/w/d.vetd", overviewCapturedAt: 42 };
		await act(async () => root.render(<ScreenshotCard {...props} />));
		await flush();
		expect(toVettaFileUrl).toHaveBeenCalledTimes(1);
		expect(host.innerHTML).toBe("");
	} finally {
		warn.mockRestore();
	}
});
